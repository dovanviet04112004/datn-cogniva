/**
 * NotesPanel — TipTap collaborative editor đồng bộ qua Yjs + Hocuspocus.
 *
 * Tách 2 component để tránh race condition Yjs init:
 *   1. NotesPanel (outer)  — setup HocuspocusProvider, đợi tới khi WS
 *      authenticated + synced rồi mới render NotesEditor.
 *   2. NotesEditor (inner) — useEditor chạy 1 lần với provider đã connected.
 *
 * Vì sao chờ connected: nếu mount editor với provider đang trong trạng thái
 * "connecting" hoặc auth fail, y-prosemirror sync plugin sẽ throw
 * "Cannot read properties of undefined (reading 'doc')" khi awareness null.
 *
 * Status flow:
 *   - idle      : đang fetch token
 *   - connecting: WS đang handshake
 *   - synced    : Yjs initial sync done → ready để mount editor
 *   - error     : auth fail / WS close / token endpoint fail
 */
'use client';

import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
// TipTap v3 rename `collaboration-cursor` (cũ, dùng y-prosemirror) → `collaboration-caret`
// (mới, dùng @tiptap/y-tiptap — match với Collaboration extension). Hai package
// CŨ + MỚI dùng pluginKey khác nhau → mix sẽ crash "Cannot read properties of
// undefined (reading 'doc')" trong y-prosemirror cursor-plugin.js:76.
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Placeholder from '@tiptap/extension-placeholder';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Loader2 } from 'lucide-react';

type Props = {
  roomId: string;
  userName: string;
};

type Status = 'idle' | 'connecting' | 'synced' | 'error';

/** Generate hex color stable từ string (cho cursor mỗi user 1 màu). */
function colorFromString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

export function NotesPanel({ roomId, userName }: Props) {
  const [provider, setProvider] = React.useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = React.useState<Status>('idle');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let aborted = false;
    let p: HocuspocusProvider | null = null;
    let ydoc: Y.Doc | null = null;

    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/collab-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'notes' }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? 'Không lấy được token');
        }
        const { token, url } = (await res.json()) as { token: string; url: string };
        if (aborted) return;

        ydoc = new Y.Doc();
        setStatus('connecting');
        p = new HocuspocusProvider({
          url,
          name: `room:${roomId}:notes`,
          document: ydoc,
          token,
          // Synced = Yjs initial sync done → safe to mount editor
          onSynced: () => {
            if (!aborted) {
              setProvider(p);
              setStatus('synced');
            }
          },
          onAuthenticationFailed: ({ reason }) => {
            if (!aborted) {
              setError(`Auth fail: ${reason}`);
              setStatus('error');
            }
          },
          onClose: ({ event }) => {
            // WS close trước khi synced → coi là error
            if (!aborted && status !== 'synced') {
              setError(`WS closed: code ${event.code} ${event.reason || '(no reason)'}`);
              setStatus('error');
            }
          },
        });
      } catch (err) {
        if (!aborted) {
          setError((err as Error).message);
          setStatus('error');
        }
      }
    })();

    return () => {
      aborted = true;
      p?.destroy();
      ydoc?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm font-medium text-destructive">Không kết nối được</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Check:
          </p>
          <ul className="mt-1 text-xs text-muted-foreground list-disc list-inside text-left inline-block">
            <li><code className="rounded bg-muted px-1">pnpm dev:hocus</code> đang chạy?</li>
            <li><code className="rounded bg-muted px-1">JWT_SECRET</code> trong <code className="rounded bg-muted px-1">apps/web/.env.local</code> ≥32 ký tự?</li>
            <li>Restart hocus sau khi đổi env: Ctrl+C → <code className="rounded bg-muted px-1">pnpm dev:hocus</code></li>
          </ul>
        </div>
      </div>
    );
  }

  if (status !== 'synced' || !provider) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">
          {status === 'idle' ? 'Đang lấy token...' : 'Đang đồng bộ Yjs...'}
        </span>
      </div>
    );
  }

  return <NotesEditor provider={provider} userName={userName} />;
}

/**
 * NotesEditor — mount khi provider ĐÃ synced. useEditor chạy 1 lần với
 * extensions ổn định. Không có race condition vì:
 *   1. provider.document đã có Yjs state (initial sync done).
 *   2. provider.awareness đã active.
 */
function NotesEditor({
  provider,
  userName,
}: {
  provider: HocuspocusProvider;
  userName: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({ placeholder: 'Ghi chú chung của phòng học...' }),
      Collaboration.configure({ document: provider.document }),
      CollaborationCaret.configure({
        provider,
        user: {
          name: userName,
          color: colorFromString(userName),
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-full focus:outline-none p-4',
      },
    },
  });

  if (!editor) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Đang khởi tạo editor...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}

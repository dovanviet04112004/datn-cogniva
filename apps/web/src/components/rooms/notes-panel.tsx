'use client';

import * as React from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Placeholder from '@tiptap/extension-placeholder';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { FolderOpen, Loader2, Save, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = {
  roomId: string;
  userName: string;
  tokenEndpoint?: string;
  roomName?: string;
};

type Status = 'idle' | 'connecting' | 'synced' | 'error';

function colorFromString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

export function NotesPanel({ roomId, userName, tokenEndpoint, roomName }: Props) {
  const [provider, setProvider] = React.useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = React.useState<Status>('idle');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let aborted = false;
    let p: HocuspocusProvider | null = null;
    let ydoc: Y.Doc | null = null;
    const endpoint = tokenEndpoint ?? `/api/rooms/${roomId}/collab-token`;

    (async () => {
      try {
        const res = await fetch(endpoint, {
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
  }, [roomId, tokenEndpoint]);

  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-destructive text-sm font-medium">Không kết nối được</p>
          <p className="text-muted-foreground mt-1 text-xs">{error}</p>
          <p className="text-muted-foreground mt-3 text-xs">Check:</p>
          <ul className="text-muted-foreground mt-1 inline-block list-inside list-disc text-left text-xs">
            <li>
              <code className="bg-muted rounded px-1">pnpm dev:hocus</code> đang chạy?
            </li>
            <li>
              <code className="bg-muted rounded px-1">JWT_SECRET</code> trong{' '}
              <code className="bg-muted rounded px-1">apps/web/.env.local</code> ≥32 ký tự?
            </li>
            <li>
              Restart hocus sau khi đổi env: Ctrl+C →{' '}
              <code className="bg-muted rounded px-1">pnpm dev:hocus</code>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (status !== 'synced' || !provider) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">
          {status === 'idle' ? 'Đang lấy token...' : 'Đang đồng bộ Yjs...'}
        </span>
      </div>
    );
  }

  return <NotesEditor provider={provider} userName={userName} roomName={roomName} />;
}

const AI_COMMAND_REGEX = /^\s*[/@]ai\s+(.+?)\s*$/i;

function matchAiCommand(lineText: string): string | null {
  const m = lineText.match(AI_COMMAND_REGEX);
  return m ? m[1]!.trim() : null;
}

function aiTextToContent(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((para) => {
    const lines = para.split('\n');
    const content: Array<{ type: 'text' | 'hardBreak'; text?: string }> = [];
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: 'hardBreak' });
      const trimmed = line;
      if (trimmed.length > 0) content.push({ type: 'text', text: trimmed });
    });
    return {
      type: 'paragraph',
      content: content.length > 0 ? content : undefined,
    };
  });
}

function NotesEditor({
  provider,
  userName,
  roomName,
}: {
  provider: HocuspocusProvider;
  userName: string;
  roomName?: string;
}) {
  const [aiBusy, setAiBusy] = React.useState(false);
  const aiBusyRef = React.useRef(false);
  const [saving, setSaving] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { data: workspaces } = useQuery({
    queryKey: qk.workspaces(),
    queryFn: () =>
      apiGet<{ workspaces?: Array<{ id: string; name: string }> }>('/api/workspaces')
        .then((d) => d.workspaces ?? [])
        .catch(() => [] as Array<{ id: string; name: string }>),
    enabled: menuOpen,
  });
  const editorRef = React.useRef<Editor | null>(null);

  const saveTo = React.useCallback(
    async (target: { id: string; name: string } | null) => {
      const editor = editorRef.current;
      if (!editor || saving) return;
      const html = editor.getHTML();
      if (!html || html === '<p></p>') {
        toast.error('Ghi chú đang trống');
        return;
      }
      setSaving(true);
      try {
        const date = new Date().toLocaleDateString('vi-VN');
        const title = roomName ? `Ghi chú phòng ${roomName} — ${date}` : `Ghi chú phòng — ${date}`;
        await apiSend('/api/notes', 'POST', {
          title,
          content: html,
          workspaceId: target?.id ?? null,
        });
        const openUrl = target ? `/workspaces/${target.id}` : '/notes';
        toast.success(target ? `Đã lưu vào "${target.name}"` : 'Đã lưu vào Notes cá nhân', {
          action: { label: 'Mở', onClick: () => window.open(openUrl, '_blank') },
        });
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [roomName, saving],
  );

  const runAi = React.useCallback(async (prompt: string) => {
    const editor = editorRef.current;
    if (!editor || aiBusyRef.current) return;
    aiBusyRef.current = true;
    setAiBusy(true);

    const { $from } = editor.state.selection;
    const start = $from.before(1);
    const end = $from.after(1);
    editor
      .chain()
      .focus()
      .deleteRange({ from: start, to: end })
      .insertContent('⏳ AI đang trả lời...')
      .run();
    const placeholderEnd = editor.state.selection.$from.after(1);
    const placeholderStart = placeholderEnd - '⏳ AI đang trả lời...'.length - 1;

    try {
      const data = await apiSend<{ text: string }>('/api/ai/quick-gen', 'POST', {
        prompt,
      });

      const cur = editorRef.current;
      if (!cur) return;
      try {
        cur
          .chain()
          .focus()
          .deleteRange({ from: placeholderStart, to: placeholderEnd })
          .insertContent(aiTextToContent(data.text))
          .run();
      } catch {
        cur.chain().focus().insertContent(aiTextToContent(data.text)).run();
      }
    } catch (err) {
      toast.error((err as Error).message);
      const cur = editorRef.current;
      if (cur) {
        cur
          .chain()
          .focus()
          .deleteRange({ from: placeholderStart, to: placeholderEnd })
          .insertContent(`/ai ${prompt}`)
          .run();
      }
    } finally {
      aiBusyRef.current = false;
      setAiBusy(false);
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({
        placeholder: 'Ghi chú chung của phòng học... Gõ /ai <câu hỏi> + Enter để hỏi AI.',
      }),
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
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.shiftKey || aiBusyRef.current) return false;
        const lineText = view.state.selection.$from.parent.textContent;
        const prompt = matchAiCommand(lineText);
        if (!prompt) return false;
        event.preventDefault();
        void runAi(prompt);
        return true;
      },
    },
  });

  React.useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  if (!editor) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Đang khởi tạo editor...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-divider bg-primary/5 text-muted-foreground flex items-center gap-1.5 border-b px-3 py-1.5 text-[10.5px]">
        <Sparkles className="text-primary h-3 w-3" />
        <span>
          Gõ <code className="bg-muted rounded px-1 font-mono">/ai &lt;câu hỏi&gt;</code> +{' '}
          <kbd className="bg-muted rounded px-1 font-mono">Enter</kbd> để AI trả lời inline.
        </span>
        {aiBusy && (
          <span className="text-primary inline-flex items-center gap-1 font-mono">
            <Loader2 className="h-3 w-3 animate-spin" />
            đang gen...
          </span>
        )}
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={saving}
              title="Snapshot ghi chú phòng này vào kho Notes của bạn (chọn workspace)"
              className="border-divider bg-background text-foreground hover:bg-muted ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Lưu vào...
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              Lưu snapshot vào
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => saveTo(null)} className="gap-2">
              <UserRound className="h-3.5 w-3.5" />
              Notes cá nhân
            </DropdownMenuItem>
            {workspaces === undefined ? (
              <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                Đang tải workspace...
              </div>
            ) : workspaces.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                  Workspace
                </DropdownMenuLabel>
                {workspaces.map((ws) => (
                  <DropdownMenuItem key={ws.id} onClick={() => saveTo(ws)} className="gap-2">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{ws.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}

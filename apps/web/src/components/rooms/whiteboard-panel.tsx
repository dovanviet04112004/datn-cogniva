/**
 * WhiteboardPanel — Excalidraw shared canvas đồng bộ qua Yjs + Hocuspocus.
 *
 * Pattern giống NotesPanel: wait connection synced trước khi mount canvas.
 * Vì Yjs sync chưa xong → onChange Excalidraw push data vào Yjs sẽ sai
 * thứ tự với remote state.
 */
'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Loader2 } from 'lucide-react';

// CSS bundle của Excalidraw — BẮT BUỘC
import '@excalidraw/excalidraw/index.css';

// Dynamic import — Excalidraw KHÔNG hỗ trợ SSR
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((m) => m.Excalidraw),
  { ssr: false, loading: () => <PanelLoading label="Đang tải canvas..." /> },
);

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

type Status = 'idle' | 'connecting' | 'synced' | 'error';

type Props = {
  roomId: string;
};

export function WhiteboardPanel({ roomId }: Props) {
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
          body: JSON.stringify({ kind: 'whiteboard' }),
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
          name: `room:${roomId}:whiteboard`,
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
  }, [roomId]);

  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm font-medium text-destructive">Không kết nối được</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Check <code className="rounded bg-muted px-1">pnpm dev:hocus</code> + <code className="rounded bg-muted px-1">JWT_SECRET</code>.
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'synced' || !provider) {
    return <PanelLoading label={status === 'idle' ? 'Đang lấy token...' : 'Đang đồng bộ Yjs...'} />;
  }

  return <WhiteboardCanvas provider={provider} />;
}

/**
 * WhiteboardCanvas — render Excalidraw + bidirectional sync Yjs ↔ canvas.
 * Mount khi provider synced.
 */
function WhiteboardCanvas({ provider }: { provider: HocuspocusProvider }) {
  const [excalidrawApi, setExcalidrawApi] = React.useState<any>(null);
  const lastSerializedRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!excalidrawApi) return;
    const yElements = provider.document.getArray<unknown>('elements');

    const applyRemoteToLocal = () => {
      const arr = yElements.toArray();
      const serialized = JSON.stringify(arr);
      if (serialized === lastSerializedRef.current) return;
      lastSerializedRef.current = serialized;
      excalidrawApi.updateScene({ elements: arr });
    };

    applyRemoteToLocal();
    yElements.observe(applyRemoteToLocal);
    return () => {
      yElements.unobserve(applyRemoteToLocal);
    };
  }, [provider, excalidrawApi]);

  const handleChange = React.useCallback(
    (elements: readonly unknown[]) => {
      const serialized = JSON.stringify(elements);
      if (serialized === lastSerializedRef.current) return; // remote loop guard
      lastSerializedRef.current = serialized;

      const yElements = provider.document.getArray('elements');
      provider.document.transact(() => {
        yElements.delete(0, yElements.length);
        yElements.push(elements as any);
      });
    },
    [provider],
  );

  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={setExcalidrawApi as any}
        onChange={handleChange}
        UIOptions={{
          canvasActions: {
            export: false,
            saveAsImage: true,
            saveToActiveFile: false,
            loadScene: false,
          },
        }}
      />
    </div>
  );
}

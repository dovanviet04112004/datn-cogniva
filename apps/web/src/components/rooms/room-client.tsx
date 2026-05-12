/**
 * RoomClient — wrapper LiveKitRoom phía client, quản lý token fetch + connect.
 *
 * Flow:
 *   1. Mount → fetch /api/rooms/{id}/token với displayName từ localStorage.
 *   2. Nhận token → render LiveKitRoom với auto connect.
 *   3. onConnected → publish mic/cam theo preference đã lưu ở lobby.
 *   4. onDisconnected → toast + router.back().
 *
 * Layout:
 *   - Main: VideoGrid (flex-1) + Pomodoro bar (top) + ControlBar (bottom).
 *   - Sidebar: Tabs (Chat | Participants | Notes | Whiteboard).
 *   - ReactionsLayer absolute overlay trên main area.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { VideoPresets } from 'livekit-client';
import { Loader2, MessageSquare, NotebookPen, PaintBucket, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VideoGrid } from './video-grid';
import { ControlBar } from './control-bar';
import { ParticipantList } from './participant-list';
import { ChatPanel } from './chat-panel';
import { ReactionsLayer } from './reactions-layer';
import { PomodoroTimer } from './pomodoro-timer';
import { RecordingBanner } from './recording-banner';

// Lazy load Notes + Whiteboard — ssr:false để tránh Next.js render initial
// HTML cho TipTap/Yjs (gây "Cannot read properties of undefined (reading 'doc')"
// vì Yjs internals chưa khởi tạo đúng khi hydration).
import dynamic from 'next/dynamic';

const NotesPanel = dynamic(
  () => import('./notes-panel').then((m) => ({ default: m.NotesPanel })),
  { ssr: false, loading: () => <PanelLoading label="Đang tải Notes..." /> },
);
const WhiteboardPanel = dynamic(
  () => import('./whiteboard-panel').then((m) => ({ default: m.WhiteboardPanel })),
  { ssr: false, loading: () => <PanelLoading label="Đang tải Whiteboard..." /> },
);

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

type Props = {
  roomId: string;
  roomName: string;
  currentUserId: string;
  currentUserName: string;
};

type TokenResponse = {
  token: string;
  serverUrl: string;
  roomName: string;
  role: 'OWNER' | 'MODERATOR' | 'MEMBER';
};

export function RoomClient({ roomId, roomName, currentUserId, currentUserName }: Props) {
  const router = useRouter();
  const [auth, setAuth] = React.useState<TokenResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const initialMicOn = React.useMemo(
    () => (typeof window === 'undefined' ? true : localStorage.getItem('room.micOn') !== 'false'),
    [],
  );
  const initialCamOn = React.useMemo(
    () => (typeof window === 'undefined' ? true : localStorage.getItem('room.camOn') !== 'false'),
    [],
  );

  React.useEffect(() => {
    const displayName = localStorage.getItem('room.displayName') ?? undefined;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data: TokenResponse = await res.json();
        if (!aborted) setAuth(data);
      } catch (err) {
        if (!aborted) setError((err as Error).message);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [roomId]);

  const handleLeave = React.useCallback(() => {
    toast.message('Đã rời phòng');
    router.push('/rooms');
  }, [router]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold text-destructive">Không thể vào phòng</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => router.push('/rooms')}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Quay lại danh sách
        </button>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Đang kết nối tới phòng {roomName}...</p>
      </div>
    );
  }

  const isMod = auth.role === 'OWNER' || auth.role === 'MODERATOR';

  return (
    <LiveKitRoom
      token={auth.token}
      serverUrl={auth.serverUrl}
      connect
      audio={initialMicOn}
      video={initialCamOn}
      onDisconnected={handleLeave}
      onError={(err) => {
        console.error('[room] LiveKit error:', err);
        toast.error(`Lỗi kết nối: ${err.message}`);
      }}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
        },
      }}
      className="grid h-full grid-cols-1 lg:grid-cols-[1fr_360px]"
    >
      {/* ── Main column ──────────────────────── */}
      <main className="relative flex min-h-0 flex-col">
        {/* Recording banner — privacy notice khi REC active (Phase 15) */}
        <RecordingBanner roomId={roomId} />

        {/* Top bar: room name + pomodoro */}
        <div className="flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur">
          <h2 className="text-sm font-semibold">{roomName}</h2>
          <PomodoroTimer canControl={isMod} />
        </div>

        <VideoGrid />
        <ControlBar onLeave={handleLeave} roomId={roomId} isMod={isMod} />

        {/* Floating emoji overlay */}
        <ReactionsLayer />
      </main>

      {/* ── Sidebar ─────────────────────────── */}
      <aside className="hidden min-h-0 border-l bg-background lg:flex lg:flex-col">
        <Tabs defaultValue="chat" className="flex h-full flex-col">
          <TabsList className="m-2 grid grid-cols-4">
            <TabsTrigger value="chat" aria-label="Chat" title="Chat">
              <MessageSquare className="h-3.5 w-3.5" />
            </TabsTrigger>
            <TabsTrigger value="participants" aria-label="Người tham gia" title="Người tham gia">
              <Users className="h-3.5 w-3.5" />
            </TabsTrigger>
            <TabsTrigger value="notes" aria-label="Notes" title="Notes">
              <NotebookPen className="h-3.5 w-3.5" />
            </TabsTrigger>
            <TabsTrigger value="whiteboard" aria-label="Whiteboard" title="Whiteboard">
              <PaintBucket className="h-3.5 w-3.5" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="m-0 min-h-0 flex-1">
            <ChatPanel roomId={roomId} currentUserId={currentUserId} />
          </TabsContent>
          <TabsContent value="participants" className="m-0 flex-1 overflow-y-auto">
            <ParticipantList roomId={roomId} myRole={auth.role} myUserId={currentUserId} />
          </TabsContent>
          <TabsContent value="notes" className="m-0 min-h-0 flex-1">
            <NotesPanel roomId={roomId} userName={currentUserName} />
          </TabsContent>
          <TabsContent value="whiteboard" className="m-0 min-h-0 flex-1">
            <WhiteboardPanel roomId={roomId} />
          </TabsContent>
        </Tabs>
      </aside>

      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

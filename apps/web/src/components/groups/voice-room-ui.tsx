/**
 * VoiceRoomUI — phần UI BÊN TRONG LiveKitRoom (tách khỏi voice-channel.tsx để
 * VoiceSessionProvider lift connection lên global mà giữ nguyên giao diện).
 *
 * KHÔNG tự mount LiveKitRoom — render bên trong context room do
 * VoiceSessionProvider cung cấp. Gồm: header, VoiceStage, control
 * bar, sidebar (chat/notes/whiteboard). Audio do <RoomAudioRenderer> trong
 * VoiceStage đảm nhiệm (1 instance duy nhất).
 */
'use client';

import * as React from 'react';
import { useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import {
  ChevronRight,
  ChevronsLeft,
  Loader2,
  MessageSquare,
  NotebookPen,
  PaintBucket,
  PictureInPicture2,
  Volume2,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { ReactionsLayer } from '@/components/rooms/reactions-layer';

import { VoiceRecordingBanner } from './voice-record-control';
import { VoiceStage } from './voice-stage';
import { VoiceControlBar } from './voice-control-bar';
import { VoiceStateSync } from './voice-state-sync';
import { VoiceTextChat } from './voice-text-chat';

const NotesPanel = dynamic(
  () => import('@/components/rooms/notes-panel').then((m) => ({ default: m.NotesPanel })),
  { ssr: false, loading: () => <PanelLoading label="Đang tải Notes..." /> },
);
const WhiteboardPanel = dynamic(
  () => import('@/components/rooms/whiteboard-panel').then((m) => ({ default: m.WhiteboardPanel })),
  { ssr: false, loading: () => <PanelLoading label="Đang tải Whiteboard..." /> },
);

/** Chỉ báo trạng thái kết nối voice — "Đang kết nối..." (animate) → "Đã kết nối". */
function ConnStatus() {
  const state = useConnectionState();
  const connected = state === ConnectionState.Connected;
  return (
    <span
      className={cn(
        'hidden items-center gap-1 text-xs sm:inline-flex',
        connected ? 'text-emerald-500' : 'text-amber-500',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          connected ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
        )}
      />
      {connected ? 'Đã kết nối' : 'Đang kết nối...'}
    </span>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

const SIDEBAR_STORAGE_KEY = 'cogniva.voice.sidebar.collapsed';

export type VoiceRoomMeta = {
  id: string;
  name: string;
  topic: string | null;
  groupId: string;
};

export function VoiceRoomUI({
  channel,
  myRole,
  currentUserId,
  currentUserName,
  currentUserImage,
  onLeave,
  onPiP,
}: {
  channel: VoiceRoomMeta;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
  onLeave: () => void;
  /** Mở cửa sổ nổi PiP — undefined nếu trình duyệt không hỗ trợ. */
  onPiP?: () => void;
}) {
  // Voice room VIDEO-FIRST: mặc định ĐÓNG sidebar (video full-width căn giữa, hết
  // cảm giác "lệch trái" do chat panel 360px trống bên phải). Mở chat/notes/bảng
  // khi user bấm toggle; lựa chọn được nhớ qua localStorage ('0' = đã mở).
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);

  React.useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_STORAGE_KEY) === '0') setSidebarCollapsed(false);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Deferred pre-warm: vào phòng KHÔNG tải Notes/Whiteboard ngay (mount nhẹ,
  // không chặn render voice + không kéo Excalidraw/2 WS lên đầu). Sau ~1.2s
  // (voice đã interactive) mới render ngầm để connect/sync Yjs trước → bấm tab là
  // synced sẵn. Nếu user bấm SỚM hơn (onValueChange) thì warm ngay, không chờ.
  const [warm, setWarm] = React.useState(false);
  React.useEffect(() => {
    const id = window.setTimeout(() => setWarm(true), 1200);
    return () => window.clearTimeout(id);
  }, []);

  const canRecord = myRole !== 'MEMBER';
  const localMeta = {
    [currentUserId]: { avatar: currentUserImage, role: myRole },
  };

  // Ref tới ROOT (cả stage + control bar + CHAT aside) → fullscreen gồm CẢ chat
  // bên phải (trước fullscreen mỗi <main> nên không mở được chat khi full).
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Fullscreen + auto-ẩn chrome (header/control bar) khi RẢNH, hiện lại khi DI
  // CHUỘT — kiểu Discord/video player. Chỉ áp dụng khi đang toàn màn hình.
  const [isFs, setIsFs] = React.useState(false);
  const [chromeHidden, setChromeHidden] = React.useState(false);

  React.useEffect(() => {
    const onFs = () => setIsFs(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  React.useEffect(() => {
    if (!isFs) {
      setChromeHidden(false);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setChromeHidden(true), 3000); // 3s rảnh → ẩn
    };
    const reveal = () => {
      setChromeHidden(false);
      schedule();
    };
    el.addEventListener('mousemove', reveal);
    el.addEventListener('mousedown', reveal);
    schedule();
    return () => {
      clearTimeout(timer);
      el.removeEventListener('mousemove', reveal);
      el.removeEventListener('mousedown', reveal);
    };
  }, [isFs]);

  return (
    <div
      ref={rootRef}
      className={cn(
        'grid h-full grid-cols-1 transition-[grid-template-columns] duration-200 bg-zinc-950',
        sidebarCollapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-[1fr_360px]',
      )}
    >
      <VoiceStateSync channelId={channel.id} currentUserId={currentUserId} />

      <main
        className={cn('relative flex min-h-0 flex-col bg-zinc-950', isFs && chromeHidden && 'cursor-none')}
      >
        {/* Header dùng token theme. Khi fullscreen → overlay top + auto-ẩn. */}
        <header
          className={cn(
            // pl-12/pr-12 mobile: chừa chỗ cho nút PanelLeft (trái, md:hidden) +
            // Users (phải, lg:hidden) của group-shell float đè lên → tên kênh
            // không bị cắt. md:pl-4 (PanelLeft ẩn) · lg:pr-14 (Users ẩn, nút PiP).
            'flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-900/90 pl-12 pr-12 text-white backdrop-blur md:pl-4 lg:pr-14',
            isFs && 'absolute inset-x-0 top-0 z-30 transition-all duration-300',
            isFs && chromeHidden && '-translate-y-full opacity-0',
          )}
        >
          <Volume2 className="h-4 w-4 shrink-0 text-white/60" />
          <span className="truncate font-semibold">{channel.name}</span>
          <ConnStatus />
          <div className="ml-auto" />
          {onPiP && (
            <button
              type="button"
              onClick={onPiP}
              aria-label="Cửa sổ nổi (PiP)"
              title="Mở cửa sổ nổi — xem khi sang tab/app khác"
              className="hidden h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white lg:inline-flex"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Mở sidebar' : 'Đóng sidebar'}
            title={sidebarCollapsed ? 'Mở sidebar (chat / notes / bảng)' : 'Đóng sidebar'}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white lg:inline-flex"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </header>
        <VoiceRecordingBanner channelId={channel.id} />
        <div className="relative min-h-0 flex-1">
          <VoiceStage participantMeta={localMeta} fullscreenRef={rootRef} />
          <ReactionsLayer />
        </div>
        {/* Control bar — fullscreen thì overlay đáy + auto-ẩn khi rảnh */}
        <div
          className={cn(
            isFs && 'absolute inset-x-0 bottom-0 z-30 transition-all duration-300',
            isFs && chromeHidden && 'pointer-events-none translate-y-full opacity-0',
          )}
        >
          <VoiceControlBar
            channelId={channel.id}
            currentUserId={currentUserId}
            canRecord={canRecord}
            onLeave={onLeave}
          />
        </div>
      </main>

      <aside
        className={cn(
          'min-h-0 border-l bg-background',
          // collapse → 'hidden' (ẩn mọi breakpoint). Trước đây base có 'lg:flex'
          // CỐ ĐỊNH nên ở màn lg nó THẮNG 'hidden' → đóng sidebar vẫn hiện, grid
          // về 1 cột → chat rớt xuống dưới stage. Bỏ lg:flex khỏi base, chỉ bật
          // ở nhánh chưa collapse.
          sidebarCollapsed ? 'hidden' : 'hidden lg:flex lg:flex-col',
        )}
      >
        <Tabs
          defaultValue="chat"
          onValueChange={(v) => {
            if (v !== 'chat') setWarm(true);
          }}
          className="flex h-full flex-col"
        >
          <TabsList className="m-2 grid grid-cols-3">
            <TabsTrigger value="chat" aria-label="Chat" title="Voice chat (ephemeral)">
              <MessageSquare className="h-3.5 w-3.5" />
            </TabsTrigger>
            <TabsTrigger value="notes" aria-label="Notes" title="Notes (collab Yjs)">
              <NotebookPen className="h-3.5 w-3.5" />
            </TabsTrigger>
            <TabsTrigger value="whiteboard" aria-label="Whiteboard" title="Whiteboard (collab Yjs)">
              <PaintBucket className="h-3.5 w-3.5" />
            </TabsTrigger>
          </TabsList>

          {/* forceMount + data-[state=inactive]:hidden: panel ở lại DOM khi đổi tab
              (Radix tự ẩn panel inactive bằng display:none, KHÔNG chồng nhau, Yjs
              không reconnect). Notes/Whiteboard chỉ render khi `warm` (deferred
              pre-warm ~1.2s sau mount HOẶC ngay khi user bấm tab) → mount nhẹ +
              vẫn synced sẵn lúc bấm. */}
          <TabsContent
            value="chat"
            forceMount
            className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <VoiceTextChat channelId={channel.id} currentUserId={currentUserId} />
          </TabsContent>
          <TabsContent
            value="notes"
            forceMount
            className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            {warm && (
              <NotesPanel
                roomId={channel.id}
                userName={currentUserName}
                roomName={channel.name}
                tokenEndpoint={`/api/channels/${channel.id}/collab-token`}
              />
            )}
          </TabsContent>
          <TabsContent
            value="whiteboard"
            forceMount
            className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            {warm && (
              <WhiteboardPanel
                roomId={channel.id}
                tokenEndpoint={`/api/channels/${channel.id}/collab-token`}
              />
            )}
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}

/**
 * Tên event realtime dùng CHUNG cho web + mobile + gateway (apps/realtime).
 *
 * Vì sao tập trung 1 chỗ:
 *  - Server `triggerEvent(channel, EV.x, data)` và client `useRealtimeEvent(channel, EV.x, h)`
 *    PHẢI khớp chính xác từng chữ — gõ tay rải rác dễ lệch (im lặng mất event).
 *  - Mobile (apps/mobile) tái dùng đúng hằng số này → không lệch với web.
 *
 * Quy ước tên: `domain:action` (giữ NGUYÊN tên lịch sử từ thời Soketi/Pusher để
 * không phải sửa ~60 call-site server + ~28 component client khi migrate sang Socket.IO).
 *
 * Nhóm `presence:*` là MỚI (gateway phát) — thay cơ chế presence built-in của Pusher.
 */
export const EV = {
  // ── Message / channel chat ──────────────────────────────
  messageNew: 'message:new',
  messageNewInChannel: 'message:new-in-channel',
  messageEdit: 'message:edit',
  messageDelete: 'message:delete',
  messagePin: 'message:pin',
  messageReact: 'message:react',
  forumSolution: 'forum:solution',
  threadNewReply: 'thread:new-reply',
  userTyping: 'user:typing',
  dmNewMessage: 'dm:new-message',

  // ── Notification 1-1 ────────────────────────────────────
  notificationNew: 'notification:new',

  // ── Voice channel ───────────────────────────────────────
  voiceJoin: 'voice:join',
  voiceLeave: 'voice:leave',
  voiceStateChanged: 'voice:state-changed',

  // ── Stage (presenter) ───────────────────────────────────
  stageHand: 'stage:hand',
  stagePromoted: 'stage:promoted',
  stageDemoted: 'stage:demoted',

  // ── Recording ───────────────────────────────────────────
  recordingStarted: 'recording:started',
  recordingStopped: 'recording:stopped',
  recordingDeleted: 'recording:deleted',
  recordingEnded: 'recording:ended',
  recordingProcessed: 'recording:processed',

  // ── User status (online/idle/dnd/invisible + text/emoji) ─
  statusChange: 'status:change',

  // ── Study room chat + AI tutor ──────────────────────────
  chatMessage: 'chat:message',
  aiStreaming: 'ai:streaming',
  aiComplete: 'ai:complete',
  aiError: 'ai:error',

  // ── Study room moderation ───────────────────────────────
  roomKicked: 'room:kicked',
  roomUnmuteRequest: 'room:unmute-request',
  roomLockChanged: 'room:lock-changed',
  roomApproved: 'room:approved',
  roomRejected: 'room:rejected',

  // ── Presence (gateway phát — thay Pusher built-in presence) ──
  presenceState: 'presence:state',
  presenceJoin: 'presence:join',
  presenceLeave: 'presence:leave',
} as const;

/** Union mọi tên event hợp lệ. */
export type RealtimeEvent = (typeof EV)[keyof typeof EV];

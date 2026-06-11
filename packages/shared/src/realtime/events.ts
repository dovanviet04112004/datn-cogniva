export const EV = {
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

  notificationNew: 'notification:new',

  voiceJoin: 'voice:join',
  voiceLeave: 'voice:leave',
  voiceStateChanged: 'voice:state-changed',

  stageHand: 'stage:hand',
  stagePromoted: 'stage:promoted',
  stageDemoted: 'stage:demoted',

  recordingStarted: 'recording:started',
  recordingStopped: 'recording:stopped',
  recordingDeleted: 'recording:deleted',
  recordingEnded: 'recording:ended',
  recordingProcessed: 'recording:processed',

  statusChange: 'status:change',

  chatMessage: 'chat:message',
  aiStreaming: 'ai:streaming',
  aiComplete: 'ai:complete',
  aiError: 'ai:error',

  roomKicked: 'room:kicked',
  roomUnmuteRequest: 'room:unmute-request',
  roomLockChanged: 'room:lock-changed',
  roomApproved: 'room:approved',
  roomRejected: 'room:rejected',

  presenceState: 'presence:state',
  presenceJoin: 'presence:join',
  presenceLeave: 'presence:leave',
} as const;

export type RealtimeEvent = (typeof EV)[keyof typeof EV];

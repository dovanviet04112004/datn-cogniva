export const ch = {
  privateChannel: (channelId: string) => `private-channel-${channelId}`,
  presenceVoice: (channelId: string) => `presence-voice-${channelId}`,
  presenceRoom: (roomId: string) => `presence-room-${roomId}`,
  presenceUser: (userId: string) => `presence-user-${userId}`,
  presenceGroup: (groupId: string) => `presence-group-${groupId}`,
  privateDm: (threadId: string) => `private-dm-${threadId}`,
} as const;

export type ChannelKind =
  | 'private-channel'
  | 'presence-voice'
  | 'presence-room'
  | 'presence-user'
  | 'presence-group'
  | 'private-dm';

const PREFIXES: Array<{ kind: ChannelKind; prefix: string }> = [
  { kind: 'private-channel', prefix: 'private-channel-' },
  { kind: 'private-dm', prefix: 'private-dm-' },
  { kind: 'presence-voice', prefix: 'presence-voice-' },
  { kind: 'presence-room', prefix: 'presence-room-' },
  { kind: 'presence-user', prefix: 'presence-user-' },
  { kind: 'presence-group', prefix: 'presence-group-' },
];

export function parseChannel(name: string): { kind: ChannelKind; id: string } | null {
  for (const { kind, prefix } of PREFIXES) {
    if (name.startsWith(prefix)) {
      const id = name.slice(prefix.length);
      if (!id) return null;
      return { kind, id };
    }
  }
  return null;
}

export function isPresenceChannel(name: string): boolean {
  return name.startsWith('presence-');
}

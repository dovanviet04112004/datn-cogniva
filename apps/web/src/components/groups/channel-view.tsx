/**
 * ChannelView — wrapper render theo channel type.
 *
 * - TEXT/ANNOUNCEMENT → TextChannel (message list + composer)
 * - VOICE             → VoiceChannel (LiveKit room render)
 * - STAGE             → StageChannel (audience + speakers + raise hand)
 * - FORUM             → ForumChannel (post cards + tag filter + thread view)
 */
'use client';

import type { StudyGroupChannel } from '@cogniva/db';

import { TextChannel } from './text-channel';
import { VoiceChannel } from './voice-channel';
import { StageChannel } from './stage-channel';
import { ForumChannel } from './forum-channel';

type Props = {
  channel: StudyGroupChannel;
  myRole: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  currentUserId: string;
  currentUserName: string;
  currentUserImage: string | null;
};

export function ChannelView(props: Props) {
  if (props.channel.type === 'VOICE') {
    return <VoiceChannel {...props} />;
  }
  if (props.channel.type === 'STAGE') {
    return <StageChannel {...props} />;
  }
  if (props.channel.type === 'FORUM') {
    return <ForumChannel {...props} />;
  }
  return <TextChannel {...props} />;
}

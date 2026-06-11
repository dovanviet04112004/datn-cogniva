'use client';

import { ChatView } from './views/chat-view';

type Props = {
  workspaceId: string;
  workspaceName: string;
};

export function MainPanel({ workspaceId, workspaceName }: Props) {
  return <ChatView workspaceId={workspaceId} workspaceName={workspaceName} />;
}

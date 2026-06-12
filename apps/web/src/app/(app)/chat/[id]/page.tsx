import { notFound, redirect } from 'next/navigation';
import type { Message as AIMessage } from 'ai';

import { getServerSession } from '@/lib/auth-server';
import { apiServerOrNull } from '@/lib/api-server';
import { ChatDetailClient } from '@/components/chat/chat-detail-client';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

type ChatDetailResponse = {
  conversation: {
    id: string;
    title: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    createdAt: string;
  };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
    annotations?: AIMessage['annotations'];
  }>;
};

export default async function ChatDetailPage({ params }: Props) {
  const session = await getServerSession();
  if (!session) redirect('/sign-in');
  const { id } = await params;

  const data = await apiServerOrNull<ChatDetailResponse>(`/api/conversations/${id}/messages`);
  if (!data) notFound();

  const initialMessages: AIMessage[] = data.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: new Date(m.createdAt),
    annotations: m.annotations,
  }));

  return (
    <div className="h-full">
      <ChatDetailClient
        conversation={{
          id: data.conversation.id,
          title: data.conversation.title,
          workspaceId: data.conversation.workspaceId,
          workspaceName: data.conversation.workspaceName,
        }}
        initialMessages={initialMessages}
      />
    </div>
  );
}

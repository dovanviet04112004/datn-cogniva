/**
 * /chat/new — trang chat trống. Sau khi user gửi message đầu tiên,
 * server tạo conversation và trả `conversationId` qua data stream;
 * ChatInterface tự navigate sang `/chat/[id]` để URL ổn định.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { ChatInterface } from '@/components/chat/chat-interface';

export const runtime = 'nodejs';

export default async function NewChatPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?redirect=/chat/new');
  return <ChatInterface />;
}

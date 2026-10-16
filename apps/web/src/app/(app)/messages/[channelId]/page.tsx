import { Suspense } from 'react';
import { Conversation } from '@/components/messages/conversation';
import { MessageSkeletons } from '@/components/messages/status-bits';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  return (
    <Suspense fallback={<MessageSkeletons />}>
      <Conversation key={channelId} channelId={channelId} />
    </Suspense>
  );
}

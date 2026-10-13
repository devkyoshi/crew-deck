import { AcceptInviteForm } from './accept-invite-form';

export const metadata = { title: 'Accept invitation · Crew Deck' };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptInviteForm token={token ?? ''} />;
}

import { MessagesShell } from '@/components/messages/messages-shell';

export const metadata = { title: 'Messages · Crew Deck' };

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <MessagesShell>{children}</MessagesShell>;
}

import { notFound } from 'next/navigation';
import { ToastLab } from './toast-lab';

export const metadata = { title: 'Toast lab · Crew Deck' };

/** Dev-only playground for trying toast styles. Not available in production. */
export default function ToastLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ToastLab />;
}

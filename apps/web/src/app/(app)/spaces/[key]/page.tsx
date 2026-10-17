import { redirect } from 'next/navigation';

/** A space opens on its board: the header above every view already carries the overview. */
export default async function SpaceHome({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  redirect(`/spaces/${key}/board`);
}

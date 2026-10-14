'use client';

import { use } from 'react';
import { RecordDetail } from '@/components/crm/record-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RecordDetail type="deal" id={id} />;
}

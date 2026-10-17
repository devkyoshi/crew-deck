'use client';

import { Suspense } from 'react';
import { useSpace } from '@/components/spaces/space-context';
import { FlowReports } from '@/components/work/flow-reports';
import { SprintReports } from '@/components/work/sprint-reports';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  const space = useSpace();
  const scrum = space.features.includes('sprints');
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Tabs defaultValue={scrum ? 'sprint' : 'flow'} className="space-y-4">
        <TabsList aria-label="Reports">
          {scrum && <TabsTrigger value="sprint">Sprint</TabsTrigger>}
          <TabsTrigger value="flow">Flow</TabsTrigger>
        </TabsList>
        {scrum && (
          <TabsContent value="sprint">
            <SprintReports />
          </TabsContent>
        )}
        <TabsContent value="flow">
          <FlowReports />
        </TabsContent>
      </Tabs>
    </Suspense>
  );
}

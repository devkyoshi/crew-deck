'use client';

import { useState } from 'react';
import { ChevronRight, Kanban, ListFilter, MoreHorizontal, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import {
  BoardColumn,
  ColumnCreateRow,
  ColumnHeader,
  ColumnSkeleton,
  DropIndicator,
  ItemPanelSkeleton,
} from '@/components/work/board-bits';
import { LabelChip } from '@/components/work/label-bits';
import { WorkItemCard, type Density } from '@/components/work/work-card';
import {
  DueDate,
  EstimatePill,
  LockedHint,
  PriorityIcon,
  StatusChip,
  TypeIcon,
  UserAvatar,
  WipBadge,
} from '@/components/work/work-bits';
import {
  CATEGORY_META,
  PRIORITY_META,
  TYPE_META,
  type ItemType,
  type Priority,
  type StatusCategory,
  type WorkItem,
} from '@/lib/work';

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ALICE = { id: 'u1', name: 'Alice Acme', email: 'alice@acme.test', avatarUrl: null };
const BEN = { id: 'u2', name: 'Ben Builder', email: 'ben@acme.test', avatarUrl: null };

const base: WorkItem = {
  id: 'i0',
  key: 'ENG-142',
  number: 142,
  spaceId: 's',
  spaceKey: 'ENG',
  type: 'story',
  parentId: 'e1',
  parent: { id: 'e1', key: 'ENG-12', title: 'Checkout redesign', type: 'epic' },
  title: 'Let customers save a card for next time',
  description: '',
  statusId: 'st1',
  status: { id: 'st1', name: 'In Progress', category: 'in_progress', color: 'blue' },
  priority: 'high',
  assignee: ALICE,
  reporter: BEN,
  estimate: 5,
  dueDate: iso(4),
  rank: 'a0',
  resolvedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  subtasks: { total: 5, done: 2 },
  labels: [
    { id: 'l1', name: 'frontend', color: 'sky' },
    { id: 'l2', name: 'payments', color: 'violet' },
    { id: 'l3', name: 'needs design', color: 'amber' },
  ],
};

const SAMPLES: Record<string, WorkItem> = {
  full: base,
  overdue: {
    ...base,
    id: 'i1',
    key: 'ENG-97',
    type: 'bug',
    priority: 'highest',
    title: 'Payment page crashes when the basket has more than twenty line items and a voucher is applied',
    parent: null,
    dueDate: iso(-3),
    assignee: BEN,
    estimate: 3,
    subtasks: { total: 0, done: 0 },
    labels: [{ id: 'l4', name: 'regression', color: 'red' }],
  },
  plain: {
    ...base,
    id: 'i2',
    key: 'ENG-150',
    type: 'task',
    priority: 'low',
    title: 'Update the onboarding copy',
    parent: null,
    assignee: null,
    estimate: null,
    dueDate: null,
    subtasks: { total: 0, done: 0 },
  },
  done: {
    ...base,
    id: 'i3',
    key: 'ENG-120',
    type: 'task',
    priority: 'medium',
    title: 'Set up error tracking',
    parent: null,
    status: { id: 'st4', name: 'Done', category: 'done', color: 'green' },
    dueDate: iso(-8),
    subtasks: { total: 3, done: 3 },
  },
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
      {children}
    </div>
  );
}

const HandleStub = () => (
  <Button variant="ghost" size="icon" className="size-6" aria-label="Drag ENG-142">
    <span className="grid grid-cols-2 gap-0.5" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="bg-muted-foreground/70 size-0.5 rounded-full" />
      ))}
    </span>
  </Button>
);
const MenuStub = () => (
  <Button variant="ghost" size="icon" className="size-6" aria-label="Card actions">
    <MoreHorizontal className="size-4" />
  </Button>
);

export function WorkShowcase() {
  const [density, setDensity] = useState<Density>('comfortable');
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(false);
  const cardProps = { density, handle: <HandleStub />, menu: <MenuStub /> };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          Work management
        </h2>
        <div role="group" aria-label="Density" className="bg-muted flex rounded-lg p-0.5 text-xs">
          {(['comfortable', 'compact'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={density === d}
              onClick={() => setDensity(d)}
              className={
                'rounded-md px-2.5 py-1 font-medium capitalize ' +
                (density === d ? 'bg-background shadow-sm' : 'text-muted-foreground')
              }
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <Block title="Item types and priorities (icon + label, never colour alone)">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(TYPE_META) as ItemType[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-sm">
              <TypeIcon type={t} size="md" /> {TYPE_META[t].label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
            <PriorityIcon key={p} priority={p} withLabel className="text-sm" />
          ))}
        </div>
      </Block>

      <Block title="Status chips by category, and the small pieces">
        <div className="flex flex-wrap items-center gap-2">
          {(['todo', 'in_progress', 'done'] as StatusCategory[]).map((c) => (
            <StatusChip
              key={c}
              category={c}
              name={CATEGORY_META[c].label}
              color={c === 'todo' ? 'slate' : c === 'done' ? 'green' : 'blue'}
            />
          ))}
          <StatusChip category="in_progress" name="In Review" color="violet" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DueDate date={iso(-2)} />
          <DueDate date={iso(1)} />
          <DueDate date={iso(9)} />
          <DueDate date={iso(-2)} done />
          <EstimatePill value={8} />
          <WipBadge count={3} limit={5} />
          <WipBadge count={5} limit={5} />
          <WipBadge count={7} limit={5} />
          <span className="flex -space-x-1.5">
            <UserAvatar person={ALICE} />
            <UserAvatar person={BEN} />
            <UserAvatar person={null} />
          </span>
          <LockedHint>Team plan</LockedHint>
        </div>
      </Block>

      <Block title="Cards (hover for handle and menu, click to select)">
        <div className="bg-muted/50 grid gap-2 rounded-lg p-3 sm:grid-cols-2">
          <WorkItemCard item={SAMPLES.full!} {...cardProps} selected={selected} onOpen={() => setSelected((s) => !s)} />
          <WorkItemCard item={SAMPLES.overdue!} {...cardProps} />
          <WorkItemCard item={SAMPLES.plain!} {...cardProps} />
          <WorkItemCard item={SAMPLES.done!} {...cardProps} />
          <div className="space-y-1 sm:col-span-2">
            <p className="text-muted-foreground text-xs">Dragging: placeholder left behind, copy follows the pointer</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <WorkItemCard item={SAMPLES.plain!} {...cardProps} dragging />
              <div className="p-1">
                <WorkItemCard item={SAMPLES.full!} {...cardProps} overlay />
              </div>
            </div>
          </div>
          <div className="sm:col-span-2">
            <DropIndicator />
          </div>
        </div>
      </Block>

      <Block title="Columns: normal, over its WIP limit, collapsed">
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          <BoardColumn
            category="in_progress"
            density={density}
            className="max-h-[480px]"
            header={
              <ColumnHeader
                name="In Progress"
                category="in_progress"
                color="blue"
                count={3}
                wipLimit={2}
                onToggle={() => setCollapsed(true)}
                menu={<MenuStub />}
              />
            }
            footer={<ColumnCreateRow onCreate={(t) => void toast.success(`Would create “${t}”`)} />}
          >
            <WorkItemCard item={SAMPLES.full!} {...cardProps} />
            <WorkItemCard item={SAMPLES.overdue!} {...cardProps} />
            <WorkItemCard item={SAMPLES.plain!} {...cardProps} />
          </BoardColumn>
          <BoardColumn
            category="done"
            density={density}
            highlight
            className="max-h-[480px]"
            header={<ColumnHeader name="Done (drop target)" category="done" color="green" count={1} />}
          >
            <WorkItemCard item={SAMPLES.done!} {...cardProps} />
          </BoardColumn>
          <BoardColumn
            category="todo"
            collapsed={collapsed}
            density={density}
            className="max-h-[480px]"
            header={
              <ColumnHeader
                name="To Do"
                category="todo"
                color="slate"
                count={12}
                collapsed={collapsed}
                onToggle={() => setCollapsed((c) => !c)}
              />
            }
          />
          {collapsed ? null : (
            <p className="text-muted-foreground self-center text-xs">
              Collapse a column with its chevron; the third column can be toggled.
            </p>
          )}
        </div>
      </Block>

      <Block title="Labels, selected card, filter chips and a swimlane header">
        <div className="flex flex-wrap gap-1.5">
          {(['slate', 'blue', 'sky', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'violet'] as const).map((c) => (
            <LabelChip key={c} label={{ name: c, color: c }} />
          ))}
        </div>
        <div className="bg-muted/50 grid gap-2 rounded-lg p-3 sm:grid-cols-2">
          <WorkItemCard item={SAMPLES.full!} {...cardProps} selected />
          <div className="space-y-3">
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters (example)">
              <li className="text-muted-foreground flex items-center gap-1 text-xs">
                <ListFilter className="size-3.5" aria-hidden /> Showing
              </li>
              {['Assignee: Alice Acme', 'Priority: High', 'Label: payments'].map((t) => (
                <li key={t}>
                  <span className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs">
                    {t}
                    <span className="rounded-full p-0.5" aria-hidden>
                      <X className="size-3" />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium">
              <ChevronRight className="size-4 rotate-90" aria-hidden />
              <UserAvatar person={ALICE} size={20} /> Alice Acme
              <span className="text-muted-foreground text-xs font-normal tabular-nums">4</span>
            </div>
            <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium">
              <ChevronRight className="size-4" aria-hidden />
              <UserAvatar person={null} size={20} /> Unassigned
              <span className="text-muted-foreground text-xs font-normal tabular-nums">2</span>
            </div>
          </div>
        </div>
      </Block>

      <Block title="Loading skeletons">
        <div className="flex gap-3 overflow-x-auto pb-2">
          <ColumnSkeleton density={density} />
          <ColumnSkeleton density={density} />
        </div>
        <div className="rounded-lg border">
          <ItemPanelSkeleton />
        </div>
      </Block>

      <Block title="Empty board">
        <div className="rounded-lg border border-dashed">
          <EmptyState
            icon={Kanban}
            title="No work items yet"
            description="Create the first item and it appears in To Do. Drag it across as the work moves."
            action={
              <Button>
                <Plus /> Create the first item
              </Button>
            }
          />
        </div>
      </Block>
    </section>
  );
}

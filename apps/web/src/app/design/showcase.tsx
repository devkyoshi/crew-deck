'use client';

import { useState } from 'react';
import { Inbox, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { RoleBadge, StatusChip } from '@/components/shared/badges';
import { Stepper } from '@/components/shared/stepper';
import { WorkShowcase } from './work-showcase';
import { MessagesShowcase } from './messages-showcase';
import { AvatarStack, Chip, TonePill, TonedHeader } from '@/components/shared/pastel';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Flag,
  ListChecks,
  Paperclip,
  MessageSquare,
} from 'lucide-react';

const PEOPLE = [
  { name: 'Alice Acme', email: 'alice@acme.test', role: 'owner', status: 'active' },
  { name: 'Ben Builder', email: 'ben@acme.test', role: 'admin', status: 'active' },
  { name: 'Cara Coder', email: 'cara@acme.test', role: 'member', status: 'invited' },
  { name: 'Dev Deactivated', email: 'dev@acme.test', role: 'viewer', status: 'deactivated' },
];

const STEPS = ['Basics', 'Visibility', 'Members', 'Review'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Showcase() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Design system"
        description="Shared components, shown in this theme."
        action={
          <Button onClick={() => toast.success('Changes saved')}>
            <Plus /> Primary action
          </Button>
        }
      />

      <Section title="Cards and column headers">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['blue', ListChecks, 'To do', 2, 'Medium', 'amber'],
              ['pink', CircleAlert, 'On review', 3, 'Low', 'blue'],
            ] as const
          ).map(([tone, icon, title, count, prio, pt]) => (
            <div key={title} className="space-y-3">
              <TonedHeader
                tone={tone}
                icon={icon}
                title={title}
                count={count}
                action={<Plus className="text-muted-foreground size-4" />}
              />
              <div className="bg-card space-y-3 rounded-2xl border p-4">
                <div className="flex items-center justify-between">
                  <Chip icon={CalendarClock}>Due: 5 Dec, 2026</Chip>
                  <MoreHorizontal className="text-muted-foreground size-4" />
                </div>
                <div>
                  <div className="font-medium">Design system update</div>
                  <p className="text-muted-foreground truncate text-xs">
                    Reviewing updated components and accessibility
                  </p>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Assigned for</span>
                  <AvatarStack names={['Alice Acme', 'Ben Builder', 'Cara Coder']} />
                </div>
                <div className="flex items-center justify-between border-t pt-3">
                  <TonePill tone={pt} icon={Flag}>
                    {prio}
                  </TonePill>
                  <div className="flex gap-1.5">
                    <Chip icon={Paperclip}>3</Chip>
                    <Chip icon={MessageSquare}>7</Chip>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <TonedHeader tone="green" icon={CheckCircle2} title="Completed" count={6} />
      </Section>

      <Section title="Buttons and badges">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button size="icon" variant="outline" aria-label="Search">
            <Search />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RoleBadge role="owner" />
          <RoleBadge role="admin" />
          <RoleBadge role="member" />
          <RoleBadge role="viewer" />
          <Badge variant="secondary">Tag</Badge>
          <StatusChip status="onsite" />
          <StatusChip status="remote" />
          <StatusChip status="offsite" />
          <StatusChip status="leave" />
        </div>
      </Section>

      <Section title="Data table">
        <div className="flex flex-wrap gap-2">
          <div className="relative max-w-xs min-w-40 flex-1">
            <Search
              className="text-muted-foreground absolute top-2.5 left-2.5 size-4"
              aria-hidden
            />
            <Input className="pl-8" placeholder="Search people" aria-label="Search people" />
          </div>
          <Badge variant="outline">Role: any</Badge>
          <Badge variant="outline">Status: active</Badge>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox aria-label="Select all" />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PEOPLE.map((p) => (
                <TableRow key={p.email}>
                  <TableCell>
                    <Checkbox aria-label={`Select ${p.name}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarFallback className="text-xs">
                          {p.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-muted-foreground text-xs">{p.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={p.role} />
                  </TableCell>
                  <TableCell>
                    <StatusChip status={p.status} />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${p.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View profile</DropdownMenuItem>
                        <DropdownMenuItem>Change role</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive">Deactivate</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Multi-step form">
        <Card>
          <CardHeader>
            <Stepper steps={STEPS} current={step} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <CardTitle>{STEPS[step]}</CardTitle>
              <CardDescription>
                Related fields are grouped in cards with helper text.
              </CardDescription>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="d-name">Space name</Label>
                <Input id="d-name" placeholder="Engineering" />
                <p className="text-muted-foreground text-xs">Shown in the sidebar.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-key">Key</Label>
                <Input
                  id="d-key"
                  defaultValue="E"
                  aria-invalid="true"
                  aria-describedby="d-key-err"
                />
                <p id="d-key-err" className="text-destructive text-xs">
                  Key must be at least 2 characters.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Default role</Label>
                <Select defaultValue="member">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="d-private">Private space</Label>
                <Switch id="d-private" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="d-desc">Description</Label>
                <Textarea id="d-desc" rows={3} />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            <Button
              onClick={() =>
                step === STEPS.length - 1 ? toast.success('Space created') : setStep((s) => s + 1)
              }
            >
              {step === STEPS.length - 1 ? 'Create space' : 'Next'}
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Tabs, loading and empty states">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <div className="mb-3">
              <Button variant="outline" size="sm" onClick={() => setLoading((l) => !l)}>
                Toggle loading
              </Button>
            </div>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : (
              <EmptyState
                icon={Inbox}
                title="No access requests"
                description="When someone asks to join a private space, the request shows up here."
                action={
                  <Button variant="outline" size="sm">
                    Learn more
                  </Button>
                }
              />
            )}
          </TabsContent>
          <TabsContent value="members" className="text-muted-foreground pt-4">
            Members tab content.
          </TabsContent>
          <TabsContent value="settings" className="text-muted-foreground pt-4">
            Settings tab content.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Feedback">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.success('Invite sent')}>
            Success toast
          </Button>
          <Button variant="outline" onClick={() => toast.error('Could not save changes')}>
            Error toast
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 /> Delete space
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this space?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. The space key will not be reusable.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Section>
      <WorkShowcase />
      <MessagesShowcase />
    </div>
  );
}

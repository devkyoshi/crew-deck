import Image from 'next/image';
import { Check, Layers } from 'lucide-react';

export type PanelVariant = 'signup' | 'verify' | 'signin' | 'workspaces' | 'invite' | 'platform';

interface PanelCopy {
  photo: string;
  headline: string;
  lead: string;
  points: string[];
}

/** The words and photo beside each signed-out screen. Photos live in /public/auth (see CREDITS.md). */
export const PANEL: Record<PanelVariant, PanelCopy> = {
  signup: {
    photo: '/auth/team-table.jpg',
    headline: 'Your whole team, in one workspace',
    lead: 'Spaces, check-in, people and a simple CRM, set up in a few minutes.',
    points: [
      '14 days of everything in Business, no card needed',
      'Your company’s data stays separate from everyone else’s',
      'Move to Free at the end of the trial. Nothing is deleted',
    ],
  },
  verify: {
    photo: '/auth/high-five.jpg',
    headline: 'Almost there',
    lead: 'Confirm who you are and choose a password. Your workspace is created the moment you finish.',
    points: [
      'You become the workspace owner',
      'Invite your team right after',
      'Change anything later in settings',
    ],
  },
  signin: {
    photo: '/auth/all-hands.jpg',
    headline: 'Welcome back',
    lead: 'Pick up where your team left off: who is in today, what is moving, what needs you.',
    points: [
      'Spaces and groups for every team',
      'Check in and see who is where',
      'Leads and deals in one place',
    ],
  },
  workspaces: {
    photo: '/auth/desk-topdown.jpg',
    headline: 'Find your team',
    lead: 'Every company has its own address. Enter yours to sign in.',
    points: [
      'Your address looks like yourcompany.example.com',
      'Ask an admin if you are not sure of it',
    ],
  },
  invite: {
    photo: '/auth/open-office.jpg',
    headline: 'You have been invited',
    lead: 'Two quick steps and you are in: tell us your name, then choose a password.',
    points: ['Your teammates are already here', 'You can update your profile any time'],
  },
  platform: {
    photo: '/auth/office-hall.jpg',
    headline: 'Platform administration',
    lead: 'For the people who run Crew Deck itself: workspaces, plans and sign-up rules.',
    points: ['Every action here is recorded', 'Workspace accounts do not work on this page'],
  },
};

/** Photo with a dark gradient so the text on it always has enough contrast. */
export function PhotoPanel({
  variant,
  compact = false,
}: {
  variant: PanelVariant;
  compact?: boolean;
}) {
  const p = PANEL[variant];
  return (
    <div className="relative isolate flex h-full min-h-0 flex-col justify-between overflow-hidden text-white">
      <Image
        src={p.photo}
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 45vw, 100vw"
        className="-z-20 object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-slate-900/45"
      />
      <div aria-hidden className="bg-primary/25 absolute inset-0 -z-10 mix-blend-multiply" />

      <div className="flex items-center gap-2 p-6 text-sm font-semibold sm:p-8">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
          <Layers className="size-4" aria-hidden />
        </span>
        Crew Deck
      </div>

      <div className={compact ? 'p-6 pt-0' : 'space-y-6 p-8 pb-10 lg:p-12 lg:pb-14'}>
        <div className="space-y-2">
          <p
            className={
              compact
                ? 'text-xl font-semibold'
                : 'text-3xl font-semibold tracking-tight lg:text-4xl'
            }
          >
            {p.headline}
          </p>
          {!compact && <p className="max-w-md text-base text-slate-100">{p.lead}</p>}
        </div>
        {!compact && (
          <ul className="space-y-3 text-sm text-slate-100">
            {p.points.map((pt) => (
              <li key={pt} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                  <Check className="size-3" aria-hidden />
                </span>
                {pt}
              </li>
            ))}
          </ul>
        )}
        {!compact && <p className="text-xs text-slate-300">Photo from Unsplash</p>}
      </div>
    </div>
  );
}

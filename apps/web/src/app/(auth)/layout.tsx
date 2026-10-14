'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SplitLayout } from '@/components/auth/split-layout';
import type { PanelVariant } from '@/components/auth/photo-panel';

/** The bare-domain origin, whether we are on it or on a workspace address like acme.example.com. */
function apexOrigin() {
  const { protocol, host } = window.location;
  const labels = host.split('.');
  const onWorkspace = labels.length > 1 && labels[0] !== 'www' && !/^\d/.test(host);
  return `${protocol}//${onWorkspace ? labels.slice(1).join('.') : host}`;
}

/** Every signed-out screen shares the photo split; the photo and words depend on the screen. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [apex, setApex] = useState<string | null>(null);
  useEffect(() => setApex(apexOrigin()), []);

  const variant: PanelVariant = pathname.startsWith('/platform')
    ? 'platform'
    : pathname.startsWith('/accept-invite')
      ? 'invite'
      : pathname.startsWith('/workspaces')
        ? 'workspaces'
        : 'signin';
  const top =
    variant === 'platform'
      ? undefined
      : variant === 'invite'
        ? { text: 'Already have an account?', label: 'Sign in', href: '/sign-in' }
        : apex
          ? { text: 'New to Crew Deck?', label: 'Create a workspace', href: `${apex}/signup` }
          : undefined;
  return (
    <SplitLayout variant={variant} top={top}>
      {children}
    </SplitLayout>
  );
}

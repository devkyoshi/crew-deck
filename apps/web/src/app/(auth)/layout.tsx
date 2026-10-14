'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AuthSplitLayout, type SplitVariant } from '@/components/auth/auth-split-layout';

/** The bare-domain origin, whether we are on it or on a workspace address like acme.example.com. */
function apexOrigin() {
  const { protocol, host } = window.location;
  const labels = host.split('.');
  const onWorkspace = labels.length > 1 && labels[0] !== 'www' && !/^\d/.test(host);
  return `${protocol}//${onWorkspace ? labels.slice(1).join('.') : host}`;
}

/**
 * Sign-in screens share the framed split layout. Accept-invite is a setup flow, so it renders on
 * a blank full screen and brings its own stepper.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [apex, setApex] = useState<string | null>(null);
  useEffect(() => setApex(apexOrigin()), []);

  if (pathname.startsWith('/accept-invite')) return <>{children}</>;

  const variant: SplitVariant = pathname.startsWith('/platform')
    ? 'platform'
    : pathname.startsWith('/workspaces')
      ? 'workspaces'
      : 'signin';
  const top =
    variant === 'platform' || !apex
      ? undefined
      : { text: 'New to Crew Deck?', label: 'Sign Up', href: `${apex}/signup` };
  return (
    <AuthSplitLayout variant={variant} top={top}>
      {children}
    </AuthSplitLayout>
  );
}

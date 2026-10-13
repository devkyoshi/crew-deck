'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RoleBadge } from '@/components/shared/badges';
import { api } from '@/lib/api';
import { initials, useMe } from './me-context';

export function useSignOut() {
  const router = useRouter();
  return async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      toast.error('Could not sign out. Try again.');
      return;
    }
    router.replace('/sign-in');
    router.refresh();
  };
}

export function UserMenu() {
  const { user, orgRole } = useMe();
  const signOut = useSignOut();
  const fallback = initials(user.name, user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-1 font-normal">
          <div className="truncate font-medium">{user.name ?? user.email}</div>
          <div className="text-muted-foreground truncate text-xs">{user.email}</div>
          <RoleBadge role={orgRole} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

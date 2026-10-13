import { Building2, House, MapPin, PartyPopper, Plane, type LucideIcon } from 'lucide-react';
import type { Tone } from '@/components/shared/pastel';
import type { Location } from './api';

export const LOCATIONS: Record<Location, { label: string; icon: LucideIcon; tone: Tone }> = {
  onsite: { label: 'Onsite', icon: Building2, tone: 'green' },
  remote: { label: 'Remote', icon: House, tone: 'blue' },
  offsite: { label: 'Offsite', icon: MapPin, tone: 'orange' },
  leave: { label: 'On leave', icon: Plane, tone: 'violet' },
  holiday: { label: 'Holiday', icon: PartyPopper, tone: 'amber' },
};

export const CHECKIN_LOCATIONS = ['onsite', 'remote', 'offsite'] as const;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

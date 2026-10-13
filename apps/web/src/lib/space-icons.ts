import {
  BarChart3,
  Briefcase,
  Bug,
  Code2,
  Folder,
  Globe,
  Lightbulb,
  Megaphone,
  Palette,
  Rocket,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** Names must match the API's SPACE_ICONS list. */
export const SPACE_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  rocket: Rocket,
  code: Code2,
  briefcase: Briefcase,
  palette: Palette,
  bug: Bug,
  chart: BarChart3,
  globe: Globe,
  shield: Shield,
  lightbulb: Lightbulb,
  users: Users,
  megaphone: Megaphone,
};

export const spaceIcon = (name: string): LucideIcon => SPACE_ICONS[name] ?? Folder;

/** Suggests a short key from a name: initials for several words, first letters for one. */
export function suggestKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const raw =
    words.length > 1
      ? words
          .map((w) => w[0])
          .join('')
          .slice(0, 5)
      : words[0]!.slice(0, 4);
  const key = raw.replace(/^[0-9]+/, '');
  return key.length >= 2 ? key : words[0]!.replace(/^[0-9]+/, '').slice(0, 3) || '';
}

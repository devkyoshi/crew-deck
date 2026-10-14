/** Rules for workspace addresses and sign-up emails. */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;

/** Names that would collide with the product's own addresses or look official. */
export const RESERVED_SLUGS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'platform',
  'signup',
  'sign-up',
  'signin',
  'sign-in',
  'login',
  'auth',
  'pricing',
  'billing',
  'support',
  'help',
  'docs',
  'blog',
  'status',
  'mail',
  'email',
  'smtp',
  'ftp',
  'static',
  'assets',
  'cdn',
  'root',
  'crewdeck',
  'crew-deck',
  'localhost',
  'test',
  'demo',
  'staging',
  'dev',
  'internal',
  'workspaces',
]);

export type SlugProblem = 'invalid' | 'reserved';

export function slugProblem(slug: string): SlugProblem | null {
  if (!SLUG_RE.test(slug) || slug.includes('--')) return 'invalid';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

export const slugMessage: Record<SlugProblem | 'taken', string> = {
  invalid:
    'Use 3 to 30 lowercase letters, numbers or hyphens, starting and ending with a letter or number',
  reserved: 'That address is reserved. Please choose another',
  taken: 'That address is already taken',
};

/** Consumer mailbox providers. Allowed by default; a platform setting can block them at sign-up. */
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'zoho.com',
]);

export const emailDomainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
export const isFreeEmailDomain = (domain: string) => FREE_EMAIL_DOMAINS.has(domain.toLowerCase());

/** A suggested workspace address from a company name. */
export function suggestSlug(company: string) {
  return company
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

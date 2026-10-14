import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const offsetOf = (q: { page: number; pageSize: number }) => (q.page - 1) * q.pageSize;

/** Escapes regex metacharacters so user input is matched literally. */
export const escapeRegex = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A case-insensitive "contains" match, for use as a Mongo filter value: `{ name: containsRegex(q) }`. */
export const containsRegex = (q: string) => ({ $regex: escapeRegex(q), $options: 'i' });

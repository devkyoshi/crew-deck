import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const offsetOf = (q: { page: number; pageSize: number }) => (q.page - 1) * q.pageSize;

/** Escapes LIKE wildcards so user input is matched literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

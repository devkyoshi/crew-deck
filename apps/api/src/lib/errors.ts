export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do this') =>
  new AppError(403, 'forbidden', msg);

/** True for a Postgres unique-constraint violation, however the driver wrapped it. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

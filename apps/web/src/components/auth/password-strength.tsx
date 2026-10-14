import { cn } from '@/lib/utils';

export const MIN_PASSWORD = 10;

/** A simple guide, not a guarantee: length matters most, then a mix of character kinds. */
export function passwordScore(pw: string) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= MIN_PASSWORD) s++;
  if (pw.length >= 14) s++;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds >= 3) s++;
  if (pw.length < MIN_PASSWORD) return Math.min(s, 1);
  return Math.max(1, s);
}

const LABELS = ['', 'Too short or too simple', 'Okay', 'Good', 'Strong'];
const BARS = ['', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'];

export function PasswordStrength({ password }: { password: string }) {
  const score = password.length < MIN_PASSWORD && password ? 1 : passwordScore(password);
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn('h-1.5 flex-1 rounded-full', i <= score ? BARS[score] : 'bg-muted')}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {password ? (
          <>
            <span className="text-foreground font-medium">{LABELS[score]}.</span>{' '}
            {password.length < MIN_PASSWORD
              ? `${MIN_PASSWORD - password.length} more characters to go.`
              : 'Long passphrases work well.'}
          </>
        ) : (
          `At least ${MIN_PASSWORD} characters. A few random words is a good start.`
        )}
      </p>
    </div>
  );
}

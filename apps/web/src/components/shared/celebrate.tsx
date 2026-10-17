'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Illustration, type IllustrationName } from '@/components/illustrations';

const COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--info)',
  'var(--destructive)',
];
const PIECES = 14;

/** A success illustration with a short confetti burst behind it. Static under reduced motion. */
export function Celebrate({ name = 'success' }: { name?: IllustrationName }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative inline-flex items-center justify-center" aria-hidden>
      {!reduce &&
        Array.from({ length: PIECES }, (_, i) => {
          const angle = (i / PIECES) * Math.PI * 2;
          const dist = 52 + (i % 3) * 14;
          return (
            <motion.span
              key={i}
              className="absolute top-1/2 left-1/2 block h-1.5 w-1.5 rounded-[2px]"
              style={{ background: COLORS[i % COLORS.length] }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
              animate={{
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist + 14,
                opacity: 0,
                scale: 1,
                rotate: 180 + i * 30,
              }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            />
          );
        })}
      <Illustration name={name} />
    </div>
  );
}

/** A full-screen confetti shower. Pass a changing `burst` number to fire it; 0 does nothing. */
export function ConfettiBurst({ burst }: { burst: number }) {
  const reduce = useReducedMotion();
  if (!burst || reduce) return null;
  return (
    <div key={burst} aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {Array.from({ length: 28 }, (_, i) => {
        const dir = (i / 28) * 2 - 1;
        return (
          <motion.span
            key={i}
            className="absolute bottom-0 left-1/2 block h-2 w-1.5 rounded-[2px]"
            style={{ background: COLORS[i % COLORS.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{
              x: dir * (160 + (i % 5) * 60),
              y: -(260 + (i % 4) * 70),
              opacity: [1, 1, 0],
              rotate: 360 + i * 40,
            }}
            transition={{ duration: 1.4 + (i % 3) * 0.2, ease: [0.15, 0.7, 0.3, 1] }}
          />
        );
      })}
    </div>
  );
}

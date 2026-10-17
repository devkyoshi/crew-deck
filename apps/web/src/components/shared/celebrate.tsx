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

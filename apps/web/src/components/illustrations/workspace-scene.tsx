import { cn } from '@/lib/utils';

const INK = 'var(--foreground)';
const LINE = 'var(--border)';
const CARD = 'var(--card)';
const WELL = 'var(--muted)';
const MAIN = 'var(--primary)';

/** A column of the little board: a dark count dot and a stack of cards. */
function Column({
  x,
  dot,
  cards,
}: {
  x: number;
  dot: string;
  cards: { h: number; bar: string; w: number }[];
}) {
  let y = 76;
  return (
    <g>
      <rect x={x} y={52} width={34} height={7} rx={3.5} fill={INK} opacity={0.75} />
      <circle cx={x + 44} cy={55.5} r={5} fill={dot} />
      {cards.map((c, i) => {
        const top = y;
        y += c.h + 8;
        return (
          <g key={i}>
            <rect x={x} y={top} width={76} height={c.h} rx={8} fill={CARD} stroke={LINE} />
            <rect x={x + 8} y={top + 9} width={c.w} height={5} rx={2.5} fill={INK} opacity={0.7} />
            <rect x={x + 8} y={top + 20} width={50} height={4} rx={2} fill={INK} opacity={0.18} />
            {c.h > 44 && (
              <rect x={x + 8} y={top + c.h - 14} width={60} height={3.5} rx={1.75} fill={WELL} />
            )}
            {c.h > 44 && (
              <rect
                x={x + 8}
                y={top + c.h - 14}
                width={c.w * 0.7}
                height={3.5}
                rx={1.75}
                fill={c.bar}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

function Spark({
  x,
  y,
  s = 1,
  tone = 'var(--warning)',
}: {
  x: number;
  y: number;
  s?: number;
  tone?: string;
}) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 -7 C1 -2 2 -1 7 0 C2 1 1 2 0 7 C-1 2 -2 1 -7 0 C-2 -1 -1 -2 0 -7Z"
      fill={tone}
    />
  );
}

/**
 * The hero picture on Home: a small board, a calendar, a chat bubble and a few teammates. Inline SVG
 * drawn from the design tokens, so it follows light and dark and the workspace accent.
 */
export function WorkspaceScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 380 240"
      fill="none"
      className={cn('h-auto w-full', className)}
      aria-hidden
      focusable="false"
    >
      <ellipse cx="190" cy="226" rx="150" ry="9" fill={INK} opacity="0.06" />

      {/* Board */}
      <rect x="14" y="26" width="270" height="188" rx="18" fill={WELL} stroke={LINE} />
      <rect x="14" y="26" width="270" height="22" rx="18" fill={CARD} stroke={LINE} />
      <circle cx="32" cy="37" r="3.2" fill="var(--danger)" opacity="0.8" />
      <circle cx="43" cy="37" r="3.2" fill="var(--warning)" opacity="0.9" />
      <circle cx="54" cy="37" r="3.2" fill="var(--success)" opacity="0.85" />
      <Column
        x={28}
        dot={INK}
        cards={[
          { h: 52, bar: 'var(--info)', w: 52 },
          { h: 38, bar: 'var(--info)', w: 40 },
        ]}
      />
      <Column
        x={112}
        dot="var(--warning)"
        cards={[
          { h: 60, bar: 'var(--danger)', w: 58 },
          { h: 38, bar: 'var(--info)', w: 34 },
        ]}
      />
      <Column x={196} dot="var(--success)" cards={[{ h: 52, bar: 'var(--success)', w: 48 }]} />
      <rect
        x="196"
        y="136"
        width="76"
        height="30"
        rx="9"
        fill="none"
        stroke={INK}
        strokeOpacity="0.25"
        strokeDasharray="4 4"
      />

      {/* Chat bubble */}
      <g>
        <path
          d="M262 14h70a14 14 0 0 1 14 14v22a14 14 0 0 1-14 14h-40l-16 14v-14h-14a14 14 0 0 1-14-14V28a14 14 0 0 1 14-14Z"
          fill="var(--violet-soft)"
          stroke={LINE}
        />
        <circle cx="288" cy="40" r="3.4" fill="var(--violet)" />
        <circle cx="302" cy="40" r="3.4" fill="var(--violet)" opacity="0.7" />
        <circle cx="316" cy="40" r="3.4" fill="var(--violet)" opacity="0.4" />
      </g>

      {/* Calendar */}
      <g>
        <rect x="236" y="96" width="128" height="118" rx="16" fill={CARD} stroke={LINE} />
        <path d="M236 112a16 16 0 0 1 16-16h96a16 16 0 0 1 16 16v14H236v-14Z" fill={MAIN} />
        <rect x="262" y="88" width="6" height="16" rx="3" fill={INK} />
        <rect x="332" y="88" width="6" height="16" rx="3" fill={INK} />
        {Array.from({ length: 15 }, (_, i) => {
          const cx = 258 + (i % 5) * 22;
          const cy = 144 + Math.floor(i / 5) * 21;
          const hot = i === 8;
          const done = i === 2 || i === 6;
          return (
            <g key={i}>
              {hot && <circle cx={cx} cy={cy} r={9} fill="var(--warning)" />}
              <circle
                cx={cx}
                cy={cy}
                r={hot ? 3 : 2.6}
                fill={hot ? INK : done ? 'var(--success)' : INK}
                opacity={hot ? 1 : done ? 1 : 0.22}
              />
            </g>
          );
        })}
      </g>

      {/* Done badge */}
      <g>
        <circle cx="284" cy="206" r="0" fill="none" />
        <circle cx="360" cy="86" r="14" fill="var(--success)" stroke={CARD} strokeWidth="3" />
        <path
          d="m353.5 86 4.5 4.5 8-9"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Teammates */}
      <g>
        {[
          { cx: 56, tone: 'var(--info-soft)', skin: 'var(--info)' },
          { cx: 84, tone: 'var(--warning-soft)', skin: 'var(--warning)' },
          { cx: 112, tone: 'var(--success-soft)', skin: 'var(--success)' },
        ].map((p, i) => (
          <g key={i}>
            <circle cx={p.cx} cy={206} r={17} fill={p.tone} stroke={CARD} strokeWidth="3" />
            <circle cx={p.cx} cy={200} r={5.5} fill={p.skin} />
            <path d={`M${p.cx - 9} 216a9 8 0 0 1 18 0`} fill={p.skin} />
          </g>
        ))}
      </g>

      <Spark x={8} y={14} s={1.1} />
      <Spark x={372} y={140} s={0.8} tone="var(--info)" />
      <Spark x={226} y={14} s={0.7} tone="var(--violet)" />
    </svg>
  );
}

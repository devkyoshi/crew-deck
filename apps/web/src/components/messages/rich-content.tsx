'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProfilePopover } from './profile-popover';

/**
 * Renders a stored message body. The API has already rebuilt the document from an allow-list, and
 * this renderer only knows the same nodes and marks, so unknown content renders as nothing.
 */
type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code bg-muted relative my-1 rounded-md border">
      {language && (
        <span className="text-muted-foreground absolute top-1 left-2 text-xs uppercase">
          {language}
        </span>
      )}
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy code'}
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-muted-foreground hover:text-foreground bg-background/80 absolute top-1 right-1 rounded-sm p-1 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre className={cn('overflow-x-auto p-3 text-label leading-5', language && 'pt-5')}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const textOf = (n: Node): string => n.text ?? (n.content ?? []).map(textOf).join('');

function renderText(n: Node, key: number): ReactNode {
  let out: ReactNode = n.text ?? '';
  for (const m of n.marks ?? []) {
    if (m.type === 'bold') out = <strong>{out}</strong>;
    else if (m.type === 'italic') out = <em>{out}</em>;
    else if (m.type === 'strike') out = <s>{out}</s>;
    else if (m.type === 'underline') out = <u>{out}</u>;
    else if (m.type === 'code')
      out = <code className="bg-muted rounded-sm px-1 py-0.5 text-[0.9em]">{out}</code>;
    else if (m.type === 'link' && typeof m.attrs?.href === 'string') {
      out = (
        <a
          href={m.attrs.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary underline-offset-2 hover:underline"
        >
          {out}
        </a>
      );
    }
  }
  return <span key={key}>{out}</span>;
}

function renderNode(n: Node, key: number): ReactNode {
  const kids = () => (n.content ?? []).map(renderNode);
  switch (n.type) {
    case 'text':
      return renderText(n, key);
    case 'hardBreak':
      return <br key={key} />;
    case 'paragraph':
      return (
        <p key={key} className="min-h-[1.25em]">
          {kids()}
        </p>
      );
    case 'mention': {
      const label = `@${String(n.attrs?.label ?? 'someone')}`;
      const id = typeof n.attrs?.id === 'string' ? n.attrs.id : null;
      const style = 'mention bg-primary/10 text-primary rounded-sm px-1 font-medium';
      // Only people have a card; groups, @channel and @here are just highlighted.
      if (!id || (n.attrs?.kind && n.attrs.kind !== 'user'))
        return (
          <span key={key} className={style}>
            {label}
          </span>
        );
      return (
        <ProfilePopover key={key} person={{ id }}>
          <button
            type="button"
            className={cn(
              style,
              'hover:bg-primary/20 focus-visible:ring-ring/50 cursor-pointer outline-none transition-colors focus-visible:ring-2',
            )}
          >
            {label}
          </button>
        </ProfilePopover>
      );
    }
    case 'blockquote':
      return (
        <blockquote key={key} className="border-border text-muted-foreground border-l-2 pl-3">
          {kids()}
        </blockquote>
      );
    case 'bulletList':
      return (
        <ul key={key} className="list-disc pl-5">
          {kids()}
        </ul>
      );
    case 'orderedList':
      return (
        <ol
          key={key}
          className="list-decimal pl-5"
          start={typeof n.attrs?.start === 'number' ? n.attrs.start : 1}
        >
          {kids()}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{kids()}</li>;
    case 'codeBlock':
      return (
        <CodeBlock
          key={key}
          code={textOf(n)}
          language={typeof n.attrs?.language === 'string' ? n.attrs.language : null}
        />
      );
    case 'heading':
      return (
        <p key={key} className="font-semibold">
          {kids()}
        </p>
      );
    default:
      return null;
  }
}

export function RichContent({ doc, className }: { doc: unknown; className?: string }) {
  const root = doc as Node | null;
  if (!root || root.type !== 'doc') return null;
  return (
    <div
      className={cn(
        'space-y-1 text-sm leading-[1.45] break-words [overflow-wrap:anywhere]',
        className,
      )}
    >
      {(root.content ?? []).map(renderNode)}
    </div>
  );
}

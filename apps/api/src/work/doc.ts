/**
 * Descriptions are stored as a rich text document (ProseMirror JSON, what Tiptap uses in W3). Until
 * the editor arrives the API speaks plain text and keeps one paragraph per line, so no migration of
 * stored data is needed later.
 */
type Node = { type: string; text?: string; content?: Node[]; attrs?: Record<string, unknown> };

const INLINE = new Set(['text', 'mention', 'hardBreak']);

export function textToDoc(text: string | null | undefined): Node | null {
  const t = text?.replace(/\r\n/g, '\n').trim();
  if (!t) return null;
  return {
    type: 'doc',
    content: t.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

export function docToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const walk = (n: Node): string => {
    if (typeof n.text === 'string') return n.text;
    if (n.type === 'mention') return `@${String(n.attrs?.label ?? 'someone')}`;
    if (n.type === 'hardBreak') return '\n';
    const kids = n.content ?? [];
    // Inline content runs together; blocks (paragraphs, list items, headings) take a line each.
    const inline = kids.length > 0 && kids.every((k) => INLINE.has(k.type));
    return kids.map(walk).join(inline ? '' : '\n');
  };
  return walk(doc as Node);
}

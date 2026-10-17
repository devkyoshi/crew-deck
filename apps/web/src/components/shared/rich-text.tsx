'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, ReactRenderer, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Person } from '@/lib/work';

/**
 * Rich text for descriptions and comments (Tiptap). Documents travel as ProseMirror JSON; the API
 * rebuilds them from an allow-list, so this editor only offers what the server accepts: paragraphs,
 * headings, lists, checklists, quotes, code, links and @mentions.
 */

export type RichDoc = JSONContent;

/** True when the document has no text and no mentions. */
export function isEmptyDoc(doc: RichDoc | null | undefined): boolean {
  if (!doc) return true;
  const walk = (n: JSONContent): boolean =>
    n.type === 'mention' || (typeof n.text === 'string' && n.text.trim() !== '') || (n.content ?? []).some(walk);
  return !walk(doc);
}

/** A plain-text description as a document, for items saved before the editor existed. */
export function textToDoc(text: string): RichDoc | null {
  const t = text.trim();
  if (!t) return null;
  return {
    type: 'doc',
    content: t.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

function extensions(opts: { placeholder?: string; searchPeople?: (q: string) => Promise<Person[]> }) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'], defaultProtocol: 'https' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: opts.placeholder ?? '' }),
    Mention.configure({
      HTMLAttributes: { class: 'mention' },
      renderText: ({ node }) => `@${node.attrs.label ?? 'someone'}`,
      renderHTML: ({ node, options }) => ['span', options.HTMLAttributes, `@${node.attrs.label ?? 'someone'}`],
      // Leave the default in place for read-only views: Mention reads `suggestion.char` when it renders.
      ...(opts.searchPeople ? { suggestion: mentionSuggestion(opts.searchPeople) } : {}),
    }),
  ];
}

// ---- Mention suggestions --------------------------------------------------------------------------------

interface MentionListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<MentionListHandle, SuggestionProps<Person>>(function MentionList(props, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [props.items]);
  const pick = (i: number) => {
    const p = props.items[i];
    if (p) props.command({ id: p.id, label: p.name ?? p.email });
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % Math.max(props.items.length, 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + props.items.length) % Math.max(props.items.length, 1));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        pick(index);
        return props.items.length > 0;
      }
      return false;
    },
  }));
  return (
    <div role="listbox" aria-label="People to mention" className="bg-popover text-popover-foreground w-64 overflow-hidden rounded-md border p-1 shadow-md">
      {props.items.length === 0 ? (
        <p className="text-muted-foreground px-2 py-1.5 text-sm">Nobody with access matches</p>
      ) : (
        props.items.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
            className={cn('flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm', i === index && 'bg-accent text-accent-foreground')}
          >
            <span className="truncate font-medium">{p.name ?? p.email}</span>
            {p.name && <span className="text-muted-foreground truncate text-xs">{p.email}</span>}
          </button>
        ))
      )}
    </div>
  );
});

function mentionSuggestion(search: (q: string) => Promise<Person[]>) {
  return {
    char: '@',
    items: async ({ query }: { query: string }) => {
      try {
        return (await search(query)).slice(0, 8);
      } catch {
        return [];
      }
    },
    render: () => {
      let renderer: ReactRenderer<MentionListHandle, SuggestionProps<Person>> | null = null;
      let box: HTMLDivElement | null = null;
      // The list lives next to the editor (not on <body>), so it stays inside any open dialog, which
      // would otherwise block clicks and focus outside itself.
      let host: HTMLElement | null = null;
      const place = (props: SuggestionProps<Person>) => {
        const rect = props.clientRect?.();
        if (!box || !host || !rect) return;
        const base = host.getBoundingClientRect();
        const left = Math.max(0, Math.min(rect.left - base.left, base.width - 256));
        box.style.left = `${left}px`;
        box.style.top = `${rect.bottom - base.top + 4}px`;
      };
      return {
        onStart: (props: SuggestionProps<Person>) => {
          renderer = new ReactRenderer(MentionList, { props, editor: props.editor });
          host = props.editor.view.dom.parentElement ?? document.body;
          if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
          box = document.createElement('div');
          box.style.position = 'absolute';
          box.style.zIndex = '50';
          box.appendChild(renderer.element);
          host.appendChild(box);
          place(props);
        },
        onUpdate: (props: SuggestionProps<Person>) => {
          renderer?.updateProps(props);
          place(props);
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') {
            box?.remove();
            return true;
          }
          return renderer?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          box?.remove();
          renderer?.destroy();
          box = null;
          renderer = null;
        },
      };
    },
  };
}

// ---- Toolbar --------------------------------------------------------------------------------------------

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
    }),
  });
  const chain = () => editor.chain().focus();
  const tools: { key: keyof typeof state; label: string; icon: typeof Bold; run: () => void }[] = [
    { key: 'bold', label: 'Bold', icon: Bold, run: () => chain().toggleBold().run() },
    { key: 'italic', label: 'Italic', icon: Italic, run: () => chain().toggleItalic().run() },
    { key: 'strike', label: 'Strikethrough', icon: Strikethrough, run: () => chain().toggleStrike().run() },
    { key: 'code', label: 'Code', icon: Code, run: () => chain().toggleCode().run() },
    { key: 'bullet', label: 'Bulleted list', icon: List, run: () => chain().toggleBulletList().run() },
    { key: 'ordered', label: 'Numbered list', icon: ListOrdered, run: () => chain().toggleOrderedList().run() },
    { key: 'task', label: 'Checklist', icon: ListChecks, run: () => chain().toggleTaskList().run() },
    { key: 'quote', label: 'Quote', icon: Quote, run: () => chain().toggleBlockquote().run() },
    {
      key: 'link',
      label: 'Insert link',
      icon: LinkIcon,
      run: () => {
        if (editor.isActive('link')) return void chain().unsetLink().run();
        const href = window.prompt('Link address (https://…)');
        if (href && /^(https?:\/\/|mailto:)/i.test(href.trim())) chain().setLink({ href: href.trim() }).run();
      },
    },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b px-1 py-1">
      {tools.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-label={t.label}
          aria-pressed={state[t.key]}
          title={t.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={t.run}
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring rounded-sm p-1.5 outline-none focus-visible:ring-2',
            state[t.key] && 'bg-accent text-foreground',
          )}
        >
          <t.icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

// ---- Editor and view ------------------------------------------------------------------------------------

export interface RichTextEditorHandle {
  focus: () => void;
  clear: () => void;
}

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  {
    value: RichDoc | null;
    onChange: (doc: RichDoc | null) => void;
    /** Mentions offer people from this lookup (people who can open the space). */
    searchPeople?: (q: string) => Promise<Person[]>;
    label: string;
    placeholder?: string;
    autoFocus?: boolean;
    /** Ctrl/Cmd+Enter. */
    onSubmit?: () => void;
    onBlur?: () => void;
    className?: string;
  }
>(function RichTextEditor({ value, onChange, searchPeople, label, placeholder, autoFocus, onSubmit, onBlur, className }, ref) {
  const submit = useRef(onSubmit);
  submit.current = onSubmit;
  const blur = useRef(onBlur);
  blur.current = onBlur;
  const editor = useEditor({
    // Rendering waits for the browser, so the server and first client render match.
    immediatelyRender: false,
    extensions: extensions({ placeholder, searchPeople }),
    content: value ?? '',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox', class: 'rich-text min-h-20 px-3 py-2 outline-none' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && submit.current) {
          submit.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const doc = e.getJSON();
      onChange(isEmptyDoc(doc) ? null : doc);
    },
    onBlur: () => blur.current?.(),
  });

  // Follow outside changes (another save landed) without disturbing someone who is typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.getJSON();
    if (JSON.stringify(isEmptyDoc(current) ? null : current) !== JSON.stringify(value)) {
      editor.commands.setContent(value ?? '', { emitUpdate: false });
    }
  }, [editor, value]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    clear: () => editor?.commands.clearContent(true),
  }));

  return (
    <div
      className={cn(
        'bg-background focus-within:border-ring focus-within:ring-ring/30 rounded-md border focus-within:ring-2',
        className,
      )}
    >
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
});

/** Read-only rendering of a stored document. */
export function RichTextView({ doc, className }: { doc: RichDoc | null; className?: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: extensions({}),
    content: doc ?? '',
    // Not an input: no textbox role and no tab stop, so it reads like ordinary text.
    editorProps: { attributes: { class: cn('rich-text', className ?? ''), role: 'none', tabindex: '-1' } },
  });
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(doc)) {
      editor.commands.setContent(doc ?? '', { emitUpdate: false });
    }
  }, [editor, doc]);
  return <EditorContent editor={editor} />;
}

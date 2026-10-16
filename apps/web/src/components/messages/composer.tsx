'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import {
  Bold,
  Code,
  Code2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SendHorizontal,
  Strikethrough,
} from 'lucide-react';
import { MAX_MESSAGE_CHARS } from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { MessageDoc } from '@/lib/messaging-api';
import { cn } from '@/lib/utils';

export interface ComposerProps {
  /** Unsent text is kept per conversation on this device. Omit for editors that should not keep a draft. */
  draftKey?: string;
  initialDoc?: JSONContent | null;
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  /** Called with the document and its plain text. May reject; the text stays so nothing is lost. */
  onSubmit: (doc: MessageDoc, text: string) => void | Promise<void>;
  onCancel?: () => void;
  onTyping?: () => void;
  /** Up arrow in an empty composer (edit my last message). */
  onEditLast?: () => void;
  className?: string;
}

const isEmpty = (editor: Editor) => editor.getText().trim() === '' && !editor.isActive('codeBlock');

function loadDraft(key: string | undefined): JSONContent | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(`draft:${key}`);
    return raw ? (JSON.parse(raw) as JSONContent) : null;
  } catch {
    return null; // storage unavailable or corrupt: start empty
  }
}
function saveDraft(key: string | undefined, doc: JSONContent | null) {
  if (!key) return;
  try {
    if (doc) localStorage.setItem(`draft:${key}`, JSON.stringify(doc));
    else localStorage.removeItem(`draft:${key}`);
  } catch {
    /* storage unavailable: the draft just is not kept */
  }
}

function ToolButton({
  label,
  shortcut,
  active,
  onClick,
  children,
  disabled,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // Keep the editor focused and its selection intact while formatting.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] disabled:opacity-40',
            active && 'bg-accent text-accent-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {shortcut && <span className="text-muted-foreground ml-2">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function LinkButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const active = editor.isActive('link');
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setHref((editor.getAttributes('link').href as string | undefined) ?? '');
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Link"
              aria-pressed={active}
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-[3px]',
                active && 'bg-accent text-accent-foreground',
              )}
            >
              <LinkIcon className="size-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Link</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80 p-2" align="start">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const url = href.trim();
            if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run();
            else
              editor
                .chain()
                .focus()
                .extendMarkRange('link')
                .setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` })
                .run();
            setOpen(false);
          }}
        >
          <Input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="https://example.com"
            aria-label="Link address"
            className="h-8"
          />
          <Button type="submit" size="sm">
            {href.trim() ? 'Apply' : 'Remove'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The message composer (Tiptap). Enter sends, Shift+Enter adds a line; inside a code block or list
 * Enter keeps its usual job and Ctrl/Cmd+Enter sends. Drafts survive navigation and reloads.
 */
export function Composer({
  draftKey,
  initialDoc,
  placeholder = 'Write a message',
  autoFocus,
  submitLabel = 'Send message',
  onSubmit,
  onCancel,
  onTyping,
  onEditLast,
  className,
}: ComposerProps) {
  const submitRef = useRef<() => void>(() => {});
  const propsRef = useRef({ onTyping, onEditLast, onCancel });
  propsRef.current = { onTyping, onEditLast, onCancel };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    content: initialDoc ?? undefined,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': placeholder,
        class:
          'rich-text max-h-60 min-h-[2.5rem] overflow-y-auto px-3 py-2 text-[14px] outline-none',
      },
    },
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ['http', 'https', 'mailto'],
          defaultProtocol: 'https',
        },
      }),
      Placeholder.configure({ placeholder }),
      Extension.create({
        name: 'messageKeys',
        addKeyboardShortcuts() {
          return {
            Enter: ({ editor }) => {
              // Code blocks and lists keep Enter for new lines; everything else sends.
              if (
                editor.isActive('codeBlock') ||
                editor.isActive('bulletList') ||
                editor.isActive('orderedList')
              )
                return false;
              submitRef.current();
              return true;
            },
            'Mod-Enter': () => {
              submitRef.current();
              return true;
            },
            ArrowUp: ({ editor }) => {
              if (propsRef.current.onEditLast && isEmpty(editor)) {
                propsRef.current.onEditLast();
                return true;
              }
              return false;
            },
            Escape: () => {
              if (!propsRef.current.onCancel) return false;
              propsRef.current.onCancel();
              return true;
            },
          };
        },
      }),
    ],
    onUpdate: ({ editor }) => {
      if (!isEmpty(editor)) propsRef.current.onTyping?.();
      if (!draftKey) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => saveDraft(draftKey, isEmpty(editor) ? null : editor.getJSON()),
        300,
      );
    },
  });

  // Restore this conversation's draft whenever the conversation changes.
  useEffect(() => {
    if (!editor || !draftKey || initialDoc) return;
    editor.commands.setContent(loadDraft(draftKey) ?? '', { emitUpdate: false });
  }, [editor, draftKey, initialDoc]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            codeBlock: e.isActive('codeBlock'),
            quote: e.isActive('blockquote'),
            bullets: e.isActive('bulletList'),
            numbers: e.isActive('orderedList'),
            chars: e.getText().length,
            empty: isEmpty(e),
          }
        : null,
  });

  submitRef.current = () => {
    if (!editor || busy || isEmpty(editor)) return;
    const text = editor.getText({ blockSeparator: '\n' }).trim();
    if (text.length > MAX_MESSAGE_CHARS) return;
    const doc = editor.getJSON() as MessageDoc;
    setBusy(true);
    void Promise.resolve(onSubmit(doc, text))
      .then(() => {
        editor.commands.clearContent(true);
        saveDraft(draftKey, null);
        editor.commands.focus();
      })
      .catch(() => undefined) // the caller reports the failure; the text stays in the box
      .finally(() => setBusy(false));
  };

  const over = (state?.chars ?? 0) > MAX_MESSAGE_CHARS;
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
    editor && fn(editor.chain().focus()).run();

  return (
    <div
      className={cn(
        'bg-background focus-within:border-ring focus-within:ring-ring/30 rounded-lg border shadow-xs transition-shadow focus-within:ring-[3px]',
        over && 'border-destructive focus-within:border-destructive',
        className,
      )}
    >
      {editor && (
        <div
          className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
          role="toolbar"
          aria-label="Formatting"
        >
          <ToolButton
            label="Bold"
            shortcut="Ctrl+B"
            active={state?.bold}
            onClick={() => run((c) => c.toggleBold())}
          >
            <Bold className="size-4" />
          </ToolButton>
          <ToolButton
            label="Italic"
            shortcut="Ctrl+I"
            active={state?.italic}
            onClick={() => run((c) => c.toggleItalic())}
          >
            <Italic className="size-4" />
          </ToolButton>
          <ToolButton
            label="Strikethrough"
            shortcut="Ctrl+Shift+S"
            active={state?.strike}
            onClick={() => run((c) => c.toggleStrike())}
          >
            <Strikethrough className="size-4" />
          </ToolButton>
          <span className="bg-border mx-1 h-4 w-px" aria-hidden />
          <LinkButton editor={editor} />
          <ToolButton
            label="Bulleted list"
            active={state?.bullets}
            onClick={() => run((c) => c.toggleBulletList())}
          >
            <List className="size-4" />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={state?.numbers}
            onClick={() => run((c) => c.toggleOrderedList())}
          >
            <ListOrdered className="size-4" />
          </ToolButton>
          <ToolButton
            label="Quote"
            active={state?.quote}
            onClick={() => run((c) => c.toggleBlockquote())}
          >
            <Quote className="size-4" />
          </ToolButton>
          <span className="bg-border mx-1 h-4 w-px" aria-hidden />
          <ToolButton
            label="Inline code"
            shortcut="Ctrl+E"
            active={state?.code}
            onClick={() => run((c) => c.toggleCode())}
          >
            <Code className="size-4" />
          </ToolButton>
          <ToolButton
            label="Code block"
            shortcut="Ctrl+Alt+C"
            active={state?.codeBlock}
            onClick={() => run((c) => c.toggleCodeBlock())}
          >
            <Code2 className="size-4" />
          </ToolButton>
        </div>
      )}
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <EditorContent editor={editor} />
        </div>
        <div className="flex items-center gap-1 p-1.5">
          {(state?.chars ?? 0) > MAX_MESSAGE_CHARS - 500 && (
            <span
              className={cn(
                'text-xs tabular-nums',
                over ? 'text-destructive font-medium' : 'text-muted-foreground',
              )}
              aria-live="polite"
            >
              {state?.chars}/{MAX_MESSAGE_CHARS}
            </span>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size={onCancel ? 'sm' : 'icon-sm'}
            aria-label={submitLabel}
            disabled={!editor || !!state?.empty || over}
            loading={busy}
            onClick={() => submitRef.current()}
          >
            {onCancel ? 'Save' : <SendHorizontal />}
          </Button>
        </div>
      </div>
    </div>
  );
}

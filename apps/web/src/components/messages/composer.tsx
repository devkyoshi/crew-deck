'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import {
  EditorContent,
  Extension,
  InputRule,
  ReactRenderer,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import { Placeholder } from '@tiptap/extensions';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import {
  AtSign,
  Bold,
  Code,
  Code2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Quote,
  SendHorizontal,
  Strikethrough,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  MAX_FILES_PER_MESSAGE,
  MAX_MESSAGE_CHARS,
  type AttachmentDTO,
  type SlashCommandDTO,
} from '@crew-deck/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api';
import {
  discardUpload,
  searchMentionables,
  uploadChannelFile,
  type Mentionable,
  type MessageDoc,
} from '@/lib/messaging-api';
import { cn } from '@/lib/utils';
import { EmojiPickerButton } from './emoji-picker';
import { formatSize } from './message-parts';
import { PersonAvatar } from './person-avatar';

export interface SubmitExtra {
  files: AttachmentDTO[];
  alsoInChannel: boolean;
}

/** Lets a parent (the conversation's drop zone) hand files to the composer. */
export interface ComposerHandle {
  addFiles: (files: File[]) => void;
}

export interface ComposerProps {
  /** Unsent text is kept per conversation on this device. Omit for editors that should not keep a draft. */
  draftKey?: string;
  /** Files can be attached to this channel. Omit for editors that cannot take files (editing a message). */
  channelId?: string;
  initialDoc?: JSONContent | null;
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  /** Slash commands offered when the text starts with `/`. Omit where commands do not apply. */
  commands?: SlashCommandDTO[];
  /** Show "Also send to channel" (thread replies). */
  alsoInChannelOption?: boolean;
  /** Called with the document, its plain text and any files. May reject; the text stays so nothing is lost. */
  onSubmit: (doc: MessageDoc, text: string, extra: SubmitExtra) => void | Promise<void>;
  onCancel?: () => void;
  onTyping?: () => void;
  /** Up arrow in an empty composer (edit my last message). */
  onEditLast?: () => void;
  handleRef?: Ref<ComposerHandle>;
  className?: string;
}

/** Fills the box with `/name ` (a JSON text node keeps the trailing space that HTML would trim). */
function completeSlash(editor: Editor, name: string) {
  editor
    .chain()
    .setContent(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `/${name} ` }] }] },
      { emitUpdate: true },
    )
    .focus('end')
    .run();
}

// An editor that is empty has no text and is not inside a code block.
const isEmpty = (editor: Editor) => editor.getText().trim() === '' && !editor.isActive('codeBlock');
const hasMention = (editor: Editor) =>
  JSON.stringify(editor.getJSON()).includes('"type":"mention"');

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

// ---- Emoji shortcodes (:smile:) -------------------------------------------------------------------------

type EmojiData = { emojis: Record<string, { skins: { native: string }[] }> };
let emojiData: EmojiData | null = null;
let emojiLoading: Promise<void> | null = null;
function loadEmojiData() {
  emojiLoading ??= import('@emoji-mart/data').then((m) => {
    emojiData = m.default as unknown as EmojiData;
  });
  return emojiLoading;
}

/** Typing `:smile:` turns into the emoji once the emoji data has loaded. */
const EmojiShortcodes = Extension.create({
  name: 'emojiShortcodes',
  addInputRules() {
    return [
      new InputRule({
        find: /:([a-z0-9_+-]{2,}):$/,
        handler: ({ state, range, match }) => {
          const native = emojiData?.emojis[match[1]!]?.skins[0]?.native;
          if (!native) return null;
          state.tr.insertText(native, range.from, range.to);
        },
      }),
    ];
  },
});

// ---- Mention suggestions ---------------------------------------------------------------------------------

interface MentionListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

function MentionList({
  items,
  command,
  ref,
}: SuggestionProps<Mentionable> & { ref?: Ref<MentionListHandle> }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  const pick = (i: number) => {
    const m = items[i];
    if (m) command({ id: m.id, label: m.label, kind: m.kind } as never);
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        pick(index);
        return items.length > 0;
      }
      return false;
    },
  }));
  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="bg-popover text-popover-foreground w-72 overflow-hidden rounded-md border p-1 shadow-md"
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground px-2 py-1.5 text-sm">Nobody matches</p>
      ) : (
        items.map((m, i) => (
          <button
            key={`${m.kind}-${m.id}`}
            type="button"
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
              i === index && 'bg-accent text-accent-foreground',
            )}
          >
            {m.kind === 'user' ? (
              <PersonAvatar
                person={{
                  id: m.id,
                  name: m.label,
                  email: m.sub ?? '',
                  avatarUrl: m.avatarUrl ?? null,
                }}
                size="sm"
                presence={false}
              />
            ) : (
              <span className="bg-muted flex size-6 items-center justify-center rounded-full">
                {m.kind === 'group' ? (
                  <Users className="size-3.5" />
                ) : (
                  <AtSign className="size-3.5" />
                )}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {m.kind === 'channel' || m.kind === 'here' ? `@${m.label}` : m.label}
              </span>
              {m.sub && (
                <span className="text-muted-foreground block truncate text-xs">{m.sub}</span>
              )}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function mentionSuggestion() {
  return {
    char: '@',
    items: async ({ query }: { query: string }) => searchMentionables(query),
    render: () => {
      let renderer: ReactRenderer<MentionListHandle, SuggestionProps<Mentionable>> | null = null;
      let box: HTMLDivElement | null = null;
      let host: HTMLElement | null = null;
      const place = (props: SuggestionProps<Mentionable>) => {
        const rect = props.clientRect?.();
        if (!box || !host || !rect) return;
        const base = host.getBoundingClientRect();
        // Opens above the caret: the composer sits at the bottom of the screen.
        box.style.left = `${Math.max(0, Math.min(rect.left - base.left, base.width - 288))}px`;
        box.style.bottom = `${base.bottom - rect.top + 6}px`;
      };
      return {
        onStart: (props: SuggestionProps<Mentionable>) => {
          host =
            (props.editor.view.dom.closest('[data-composer]') as HTMLElement | null) ??
            props.editor.view.dom.parentElement;
          renderer = new ReactRenderer(MentionList, { props, editor: props.editor });
          box = document.createElement('div');
          box.style.position = 'absolute';
          box.style.zIndex = '60';
          box.appendChild(renderer.element);
          host?.appendChild(box);
          place(props);
        },
        onUpdate: (props: SuggestionProps<Mentionable>) => {
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
          renderer = null;
          box = null;
        },
      };
    },
  };
}

/** Mention nodes carry what they point at: a person, a group, @channel or @here. */
const MessageMention = Mention.extend({
  priority: 200,
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: 'user' },
    };
  },
}).configure({
  HTMLAttributes: { class: 'mention' },
  renderText: ({ node }) => `@${node.attrs.label ?? 'someone'}`,
  renderHTML: ({ node, options }) => [
    'span',
    options.HTMLAttributes,
    `@${node.attrs.label ?? 'someone'}`,
  ],
  suggestion: mentionSuggestion(),
});

// ---- Toolbar -----------------------------------------------------------------------------------------------

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

// ---- Files ---------------------------------------------------------------------------------------------------

interface UploadItem {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  file?: AttachmentDTO;
  abort: AbortController;
}

function FileChips({ items, onRemove }: { items: UploadItem[]; onRemove: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 border-b px-2 py-2" aria-label="Files to send">
      {items.map((it) => (
        <li
          key={it.key}
          className={cn(
            'bg-muted/50 relative flex w-52 items-center gap-2 rounded-md border px-2 py-1.5 text-[13px]',
            it.status === 'error' && 'border-destructive/50',
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{it.name}</span>
            <span
              className={cn(
                'block text-xs',
                it.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {it.status === 'uploading'
                ? `Uploading ${it.progress}%`
                : it.status === 'error'
                  ? it.error
                  : formatSize(it.size)}
            </span>
            {it.status === 'uploading' && (
              <span className="bg-border mt-1 block h-1 overflow-hidden rounded-full">
                <span
                  className="bg-primary block h-full transition-[width]"
                  style={{ width: `${it.progress}%` }}
                />
              </span>
            )}
          </span>
          {it.status === 'uploading' && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
          )}
          <button
            type="button"
            aria-label={
              it.status === 'uploading' ? `Cancel upload of ${it.name}` : `Remove ${it.name}`
            }
            onClick={() => onRemove(it.key)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded p-0.5 outline-none focus-visible:ring-2"
          >
            <X className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The message composer (Tiptap). Enter sends, Shift+Enter adds a line; inside a code block or list
 * Enter keeps its usual job and Ctrl/Cmd+Enter sends. Drafts survive navigation and reloads. Files can
 * be attached with the button, by dropping them on the conversation, or by pasting images; people,
 * groups, @channel and @here are mentioned with `@`, and `:name:` turns into an emoji.
 */
export function Composer({
  draftKey,
  channelId,
  initialDoc,
  placeholder = 'Write a message',
  autoFocus,
  submitLabel = 'Send message',
  alsoInChannelOption,
  commands,
  onSubmit,
  onCancel,
  onTyping,
  onEditLast,
  handleRef,
  className,
}: ComposerProps) {
  const submitRef = useRef<() => void>(() => {});
  // The slash menu: what is shown and which row is chosen, read by the key handlers below.
  const slashRef = useRef<{ items: SlashCommandDTO[]; index: number; query: string }>({
    items: [],
    index: 0,
    query: '',
  });
  const [slashIndex, setSlashIndex] = useState(0);
  const propsRef = useRef({ onTyping, onEditLast, onCancel });
  propsRef.current = { onTyping, onEditLast, onCancel };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [alsoInChannel, setAlsoInChannel] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const fileInput = useRef<HTMLInputElement>(null);
  const filesEnabled = !!channelId;

  const addFiles = useCallback(
    (list: File[]) => {
      if (!channelId || list.length === 0) return;
      const room = MAX_FILES_PER_MESSAGE - uploadsRef.current.length;
      if (list.length > room)
        toast.error(`A message can have up to ${MAX_FILES_PER_MESSAGE} files`);
      for (const file of list.slice(0, Math.max(room, 0))) {
        const abort = new AbortController();
        const key = crypto.randomUUID();
        const patch = (p: Partial<UploadItem>) =>
          setUploads((cur) => cur.map((u) => (u.key === key ? { ...u, ...p } : u)));
        setUploads((cur) => [
          ...cur,
          {
            key,
            name: file.name || 'pasted-image.png',
            size: file.size,
            progress: 0,
            status: 'uploading',
            abort,
          },
        ]);
        uploadChannelFile(channelId, file, {
          signal: abort.signal,
          onProgress: (progress) => patch({ progress }),
        })
          .then((done) => patch({ status: 'done', progress: 100, file: done }))
          .catch((e) => {
            if (e instanceof DOMException && e.name === 'AbortError') return;
            patch({
              status: 'error',
              error: e instanceof ApiError ? e.message : 'Could not upload that file',
            });
          });
      }
    },
    [channelId],
  );
  useImperativeHandle(handleRef, () => ({ addFiles }), [addFiles]);

  const removeUpload = (key: string) => {
    const item = uploadsRef.current.find((u) => u.key === key);
    if (!item) return;
    item.abort.abort();
    if (item.file) void discardUpload(item.file.id);
    setUploads((cur) => cur.filter((u) => u.key !== key));
  };

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
      // Pasting an image (a screenshot, say) attaches it instead of inserting nothing.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0 || !filesEnabled) return false;
        addFiles(files);
        return true;
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
      MessageMention,
      EmojiShortcodes,
      Extension.create({
        name: 'messageKeys',
        addKeyboardShortcuts() {
          return {
            Enter: ({ editor }) => {
              // With the slash menu open, Enter completes the command name (or runs it if already complete).
              const slash = slashRef.current;
              const pick = slash.items[slash.index];
              if (pick && pick.name !== slash.query) {
                completeSlash(editor, pick.name);
                editor.commands.focus('end');
                return true;
              }
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
            Tab: ({ editor }) => {
              const slash = slashRef.current;
              const pick = slash.items[slash.index];
              if (!pick) return false;
              completeSlash(editor, pick.name);
              editor.commands.focus('end');
              return true;
            },
            ArrowDown: () => {
              const slash = slashRef.current;
              if (slash.items.length === 0) return false;
              slash.index = (slash.index + 1) % slash.items.length;
              setSlashIndex(slash.index);
              return true;
            },
            ArrowUp: ({ editor }) => {
              const slash = slashRef.current;
              if (slash.items.length > 0) {
                slash.index = (slash.index - 1 + slash.items.length) % slash.items.length;
                setSlashIndex(slash.index);
                return true;
              }
              if (propsRef.current.onEditLast && isEmpty(editor)) {
                propsRef.current.onEditLast();
                return true;
              }
              return false;
            },
            Escape: ({ editor }) => {
              if (slashRef.current.items.length > 0) {
                editor.commands.clearContent(true);
                return true;
              }
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

  // Restore this conversation's draft whenever the conversation changes; warm the emoji data.
  useEffect(() => {
    void loadEmojiData();
    if (!editor || !draftKey || initialDoc) return;
    editor.commands.setContent(loadDraft(draftKey) ?? '', { emitUpdate: false });
  }, [editor, draftKey, initialDoc]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Leaving the conversation with files still unsent discards them (the server also sweeps them).
  useEffect(
    () => () => {
      for (const u of uploadsRef.current) {
        u.abort.abort();
        if (u.file) void discardUpload(u.file.id);
      }
    },
    [],
  );

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
            slash: /^\/([a-z]*)$/i.exec(e.getText())?.[1] ?? null,
            empty: isEmpty(e) && !hasMention(e),
          }
        : null,
  });

  const slashItems = useMemo(() => {
    const q = state?.slash;
    if (q === null || q === undefined || !commands) return [];
    return commands.filter((c) => c.name.startsWith(q.toLowerCase()));
  }, [state?.slash, commands]);
  slashRef.current = {
    items: slashItems,
    index: Math.min(slashIndex, Math.max(slashItems.length - 1, 0)),
    query: (state?.slash ?? '').toLowerCase(),
  };

  const uploading = uploads.some((u) => u.status === 'uploading');
  const ready = uploads.filter((u) => u.status === 'done' && u.file).map((u) => u.file!);
  const failedUploads = uploads.some((u) => u.status === 'error');

  submitRef.current = () => {
    if (!editor || busy || uploading) return;
    if (isEmpty(editor) && !hasMention(editor) && ready.length === 0) return;
    const text = editor.getText({ blockSeparator: '\n' }).trim();
    if (text.length > MAX_MESSAGE_CHARS) return;
    const doc = editor.getJSON() as MessageDoc;
    setBusy(true);
    void Promise.resolve(onSubmit(doc, text, { files: ready, alsoInChannel }))
      .then(() => {
        editor.commands.clearContent(true);
        saveDraft(draftKey, null);
        // The files now belong to the message: forget them here without discarding them.
        setUploads([]);
        uploadsRef.current = [];
        editor.commands.focus();
      })
      .catch(() => undefined) // the caller reports the failure; the text stays in the box
      .finally(() => setBusy(false));
  };

  const over = (state?.chars ?? 0) > MAX_MESSAGE_CHARS;
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
    editor && fn(editor.chain().focus()).run();
  const canSend = !!editor && !uploading && !over && (!state?.empty || ready.length > 0);

  return (
    <div
      data-composer
      className={cn(
        'bg-background focus-within:border-ring focus-within:ring-ring/30 relative rounded-lg border shadow-xs transition-shadow focus-within:ring-[3px]',
        over && 'border-destructive focus-within:border-destructive',
        className,
      )}
    >
      {slashItems.length > 0 && (
        <ul
          role="listbox"
          aria-label="Commands"
          className="bg-popover absolute right-0 bottom-full left-0 z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border p-1 shadow-md"
        >
          {slashItems.map((c, i) => (
            <li
              key={c.name}
              role="option"
              aria-selected={i === slashRef.current.index}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5 text-sm',
                i === slashRef.current.index && 'bg-accent',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                if (editor) completeSlash(editor, c.name);
              }}
            >
              <span className="font-medium">/{c.name}</span>
              <span className="text-muted-foreground ml-2">{c.description}</span>
              <span className="text-muted-foreground block text-xs">{c.usage}</span>
            </li>
          ))}
        </ul>
      )}
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
          <span className="bg-border mx-1 h-4 w-px" aria-hidden />
          <ToolButton label="Mention someone" onClick={() => run((c) => c.insertContent('@'))}>
            <AtSign className="size-4" />
          </ToolButton>
          <EmojiPickerButton
            label="Insert emoji"
            onPick={(e) => run((c) => c.insertContent(e))}
            className="text-muted-foreground size-7"
            size="icon-sm"
            side="top"
          />
          {filesEnabled && (
            <>
              <ToolButton
                label="Attach files"
                disabled={uploads.length >= MAX_FILES_PER_MESSAGE}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="size-4" />
              </ToolButton>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-label="Choose files to attach"
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      )}
      <FileChips items={uploads} onRemove={removeUpload} />
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
            disabled={!canSend}
            loading={busy}
            onClick={() => submitRef.current()}
          >
            {onCancel ? 'Save' : <SendHorizontal />}
          </Button>
        </div>
      </div>
      {(alsoInChannelOption || failedUploads || uploading) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs">
          {alsoInChannelOption && (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={alsoInChannel}
                onCheckedChange={(v) => setAlsoInChannel(v === true)}
              />
              Also send to channel
            </label>
          )}
          {uploading && <span role="status">Waiting for files to finish uploading…</span>}
          {failedUploads && (
            <span className="text-destructive">Remove the files that did not upload to send.</span>
          )}
        </div>
      )}
    </div>
  );
}

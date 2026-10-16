'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useVocabulary } from './use-vocabulary';

const groups = (noun: string): { title: string; items: [string[], string][] }[] => [
  {
    title: 'Board',
    items: [
      [['C'], `Create a ${noun}`],
      [['/'], 'Search the board'],
      [['?'], 'Show this list'],
      [['Esc'], 'Close the panel, a dialog or the selection'],
      [['↑', '↓', '←', '→'], 'Move between cards'],
      [['Enter'], 'Open the focused card'],
    ],
  },
  {
    title: 'Moving cards',
    items: [
      [['Tab'], 'Focus a card’s drag handle'],
      [['Space'], 'Pick up the card, then drop it'],
      [['←', '→', '↑', '↓'], 'Move the picked-up card'],
      [['Esc'], 'Cancel the move'],
    ],
  },
  {
    title: `In an open ${noun}`,
    items: [
      [['M'], 'Write a comment'],
      [['A'], 'Change the assignee'],
      [['L'], 'Change the labels'],
      [['T'], 'Change the status (the transition menu)'],
      [['D'], 'Set the due date'],
      [['V'], 'Choose the fix version'],
      [['Ctrl', 'Enter'], 'Send the comment'],
    ],
  },
  {
    title: 'Selecting',
    items: [
      [['Ctrl', 'click'], 'Select or unselect a card (Cmd on a Mac)'],
      [['Esc'], 'Clear the selection'],
    ],
  },
];

export function ShortcutsOverlay({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const vocab = useVocabulary();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything on the board can be done without a mouse.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {groups(vocab.noun).map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">{g.title}</h3>
              <dl className="space-y-1.5">
                {g.items.map(([keys, text]) => (
                  <div key={text} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">{text}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <kbd key={k} className="bg-muted min-w-6 rounded border px-1.5 py-0.5 text-center text-xs font-medium">
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

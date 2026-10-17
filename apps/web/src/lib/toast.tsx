import type { ReactNode } from 'react';
import { toast as sonner } from 'sonner';
import { DropToast, type ToastKind } from '@/components/shared/drop-toast';

interface Options {
  id?: string | number;
  description?: ReactNode;
  duration?: number;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  onAutoClose?: () => void;
}

const DURATION = 3600;

function show(kind: ToastKind, message: ReactNode, o: Options = {}) {
  return sonner.custom(
    (id) => (
      <DropToast
        kind={kind}
        title={message}
        description={o.description}
        action={
          o.action && {
            label: o.action.label,
            onClick: () => {
              o.action!.onClick();
              sonner.dismiss(id);
            },
          }
        }
      />
    ),
    {
      id: o.id,
      // Anything with a button stays a little longer so it can be reached.
      duration: kind === 'loading' ? Infinity : (o.duration ?? (o.action ? 6000 : DURATION)),
      position: 'top-center',
      onDismiss: o.onDismiss,
      onAutoClose: o.onAutoClose,
    },
  );
}

/**
 * The app's toast. Same calls as Sonner's (`toast.success('Saved', { description })`), but every toast
 * is the water-drop pill. Import this, not `sonner`.
 */
export const toast = Object.assign((message: ReactNode, o?: Options) => show('info', message, o), {
  success: (message: ReactNode, o?: Options) => show('success', message, o),
  error: (message: ReactNode, o?: Options) => show('error', message, o),
  warning: (message: ReactNode, o?: Options) => show('warning', message, o),
  info: (message: ReactNode, o?: Options) => show('info', message, o),
  message: (message: ReactNode, o?: Options) => show('info', message, o),
  loading: (message: ReactNode, o?: Options) => show('loading', message, o),
  dismiss: (id?: string | number) => sonner.dismiss(id),
});

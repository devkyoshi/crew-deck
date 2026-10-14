import { useCallback, useState } from 'react';

/**
 * Drives the failed-submit feedback: bumps a counter (so each `Field` re-shakes) and focuses the
 * first invalid control. Pass `onInvalid` to react-hook-form's handleSubmit, or call `fail()`
 * from hand-rolled forms after setting their error state.
 */
export function useFormFeedback() {
  const [shakeKey, setShakeKey] = useState(0);
  const fail = useCallback(() => {
    setShakeKey((k) => k + 1);
    // Wait a frame so aria-invalid is on the DOM before looking for it.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);
  return { shakeKey, onInvalid: fail, fail };
}

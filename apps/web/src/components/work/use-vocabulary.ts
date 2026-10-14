'use client';

import { useMemo } from 'react';
import { capitalize, vocabularyFor } from '@crew-deck/shared';
import { useMaybeMe } from '@/components/shell/me-context';

/**
 * The words this workspace uses for its work: "work item" for software teams, "job" for construction,
 * "ticket" for IT support, and so on. Display only; types and keys are the same everywhere.
 */
export function useVocabulary() {
  // Outside the signed-in app (the /design showcase) the standard words are used.
  const workType = useMaybeMe()?.org.workType ?? null;
  return useMemo(() => {
    const v = vocabularyFor(workType);
    return {
      ...v,
      /** "Work item", "Job": for headings and buttons. */
      Noun: capitalize(v.noun),
      /** "1 job", "3 jobs". */
      count: (n: number) => `${n} ${n === 1 ? v.noun : v.nounPlural}`,
    };
  }, [workType]);
}

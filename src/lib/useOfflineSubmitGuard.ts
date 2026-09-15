import { useCallback, useRef, useState } from "react";

/**
 * Guards an offline-queue submission handler against firing more than
 * once concurrently.
 *
 * Needed specifically by forms whose OFFLINE branch bypasses React's
 * native `<form action>` (via `e.preventDefault()` inside a custom
 * `onSubmit`) instead of going through `useActionState` — QueryForm,
 * ItemForm, PartyForm, WarehouseForm, NewQuotationForm. Their submit
 * button disables itself via `useActionState`'s own `pending` flag,
 * but that flag is tied to the *native* form action and never becomes
 * true for a code path that never reaches it. Without this guard, a
 * rapid double (or triple, ...) click on "Save Offline" re-enters the
 * handler before the first click's `await enqueue(...)` (an IndexedDB
 * write) has finished — each re-entry generates its own fresh
 * `crypto.randomUUID()` and enqueues a genuinely separate record, so
 * what the user experienced as one submission becomes several distinct
 * rows (each with its own sequential number) once they sync. A real
 * device rapid-clicking "Save Offline" on a Query reproduced exactly
 * this — several distinct Query numbers for one intended submission.
 *
 * (Every OTHER offline-capable form already avoids this — they use
 * `useTransition` for both their online and offline branches, and a
 * real React 19 render confirmed `isPending` correctly stays true for
 * the whole duration of an async callback passed to `startTransition`,
 * disabling their button throughout. Only the five `useActionState`
 * forms above have no such coverage for their offline path.)
 *
 * `submittingRef` is checked synchronously as the very first thing the
 * guarded callback does, before any `await` — JS's single-threaded,
 * run-to-first-await event handling makes this race-free regardless of
 * click speed: only the first invocation can ever see it `false`. The
 * paired `isSubmitting` state exists purely so the submit button can
 * also be visually disabled during the guarded window — the ref alone
 * already prevents the actual duplicate.
 */
export function useOfflineSubmitGuard() {
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await fn();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, guard };
}

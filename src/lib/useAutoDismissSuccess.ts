"use client";

import { useEffect, useState } from "react";

/**
 * Turns a one-shot "it succeeded" flag from useActionState into a banner
 * that shows itself and then clears on its own a few seconds later,
 * instead of staying on screen forever (useActionState's returned state
 * only changes on the next dispatch, so `state.success` alone never goes
 * back to false by itself).
 *
 * Keyed off the whole state object's identity, not just `.success` — a
 * second, identical success (e.g. "Add another") gets its own fresh
 * state object from useActionState, so this correctly shows the banner
 * again instead of silently doing nothing because the boolean didn't
 * change. The identity check runs during render (React's own recommended
 * way to adjust state in response to a prop/state change — see
 * CompanyForm.tsx for the same pattern), so only the timer itself — a
 * real subscription to an external clock — lives in an effect.
 */
export function useAutoDismissSuccess(state: { success?: boolean }, ms = 3000): boolean {
  const [show, setShow] = useState(false);
  const [prevState, setPrevState] = useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (state.success) setShow(true);
  }

  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setShow(false), ms);
    return () => clearTimeout(timer);
  }, [show, ms]);

  return show;
}

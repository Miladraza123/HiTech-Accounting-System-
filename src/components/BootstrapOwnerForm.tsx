"use client";

import { useActionState } from "react";
import { bootstrapOwnerAction, type ActionState } from "@/app/actions/auth";

const initialState: ActionState = { error: null };

export function BootstrapOwnerForm() {
  const [state, formAction, pending] = useActionState(bootstrapOwnerAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "…" : "Main Owner hoon — access lein"}
      </button>
    </form>
  );
}

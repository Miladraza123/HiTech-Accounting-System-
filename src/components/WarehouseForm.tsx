"use client";

import { useActionState, useRef, useEffect } from "react";
import { addWarehouseAction, type ActionResult } from "@/app/actions/setup";

const initialState: ActionResult = { error: null };

export function WarehouseForm() {
  const [state, formAction, pending] = useActionState(addWarehouseAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="rounded-xl border border-line bg-surface p-5 space-y-3">
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <input name="code" placeholder="CODE" required className="input uppercase" maxLength={12} />
        <input name="name" placeholder="Warehouse ka naam" required className="input" />
      </div>
      <input name="address" placeholder="Address (optional)" className="input" />
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Add ho raha hai…" : "Warehouse Add Karen"}
      </button>
    </form>
  );
}

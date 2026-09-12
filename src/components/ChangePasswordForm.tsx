"use client";

import { useActionState, useRef, useEffect } from "react";
import { changePasswordAction, type ChangePasswordState } from "@/app/actions/auth";
import { buttonClass } from "@/components/ui/Button";

const initialState: ChangePasswordState = { error: null };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="current_password" className="text-xs font-medium text-ink-soft">
          Current password
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="new_password" className="text-xs font-medium text-ink-soft">
          New password
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="confirm_password" className="text-xs font-medium text-ink-soft">
          Re-enter new password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
        />
      </div>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Password changed.</p>}

      <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
        {pending ? "Changing…" : "Change Password"}
      </button>
    </form>
  );
}

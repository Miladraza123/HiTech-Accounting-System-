"use client";

import { useActionState, useState } from "react";
import { signInAction, type ActionState } from "@/app/actions/auth";

const initialState: ActionState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  // This page is rendered for someone who is not signed in, so it cannot ask
  // the database whether a logo exists. It just tries to load it and falls
  // back to the original monogram if the route 404s (no logo uploaded).
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {logoFailed ? (
            <>
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-ledger text-ledger-soft font-mono text-lg font-semibold">
                H
              </div>
              <h1 className="mt-4 text-xl font-semibold text-ink">Hi-Tech Business &amp; Accounting System</h1>
            </>
          ) : (
            <span className="company-logo mx-auto">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our own /api/company-logo route as plain bytes. */}
              <img
                src="/api/company-logo"
                alt="HITECH ENGINEERING"
                style={{ height: 96, width: "auto" }}
                onError={() => setLogoFailed(true)}
              />
            </span>
          )}
          <p className="mt-3 text-sm text-ink-soft">Material Supply &amp; Fabrication — Query to Cash</p>
        </div>

        <form action={formAction} className="rounded-xl border border-line bg-surface p-6 shadow-sm space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-ink-soft">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="you@company.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-ink-soft">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="••••••••"
            />
          </div>

          {state.error && (
            <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Logging in…" : "Login"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-faint">Powered by &quot;OHT Solutions&quot;</p>
      </div>
    </main>
  );
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "@/app/actions/auth";

const initialState = { error: null as string | null, message: null as string | null };

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-ledger text-ledger-soft font-mono text-lg font-semibold">
            H
          </div>
          <h1 className="mt-4 text-xl font-semibold text-ink">Naya Account</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Pehla account banane wala system ka Owner bantа hai.
          </p>
        </div>

        {state.message ? (
          <div className="rounded-xl border border-line bg-surface p-6 shadow-sm text-center space-y-3">
            <p className="text-sm text-ink">{state.message}</p>
            <Link href="/login" className="inline-block text-sm text-accent-ink underline underline-offset-2">
              Login page par jayen
            </Link>
          </div>
        ) : (
          <form action={formAction} className="rounded-xl border border-line bg-surface p-6 shadow-sm space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="full_name" className="text-xs font-medium text-ink-soft">
                Pura naam
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                required
                className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
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
                autoComplete="new-password"
                className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm" className="text-xs font-medium text-ink-soft">
                Password dobara likhen
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
                className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
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
              {pending ? "Ban raha hai…" : "Account banayen"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-ink-soft">
          Pehle se account hai?{" "}
          <Link href="/login" className="text-accent-ink underline underline-offset-2">
            Login karen
          </Link>
        </p>
      </div>
    </main>
  );
}

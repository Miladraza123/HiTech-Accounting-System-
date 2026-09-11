"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
      <p className="text-4xl font-semibold text-bad font-mono">!</p>
      <h1 className="text-lg font-semibold text-ink">Kuch ghalat ho gaya</h1>
      <p className="text-sm text-ink-soft max-w-sm">
        Is page ko load karne mein masla hua. Dobara koshish karen — agar masla rahe to Owner ko batayen.
      </p>
      {error.digest && <p className="text-[11px] text-ink-faint font-mono">Error ref: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        Dobara koshish karen
      </button>
    </div>
  );
}

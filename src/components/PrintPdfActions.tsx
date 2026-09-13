"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadPdfButton } from "@/components/DownloadPdfButton";

/**
 * Replaces the old plain "Print / PDF" link + "Download PDF" button
 * pair once the company has a signature, stamp, phone, and/or email set
 * up — asks, independently, whether to include each on THIS particular
 * document before opening the print view or generating the PDF. When
 * none of the four apply, renders exactly the old pair unchanged (no
 * prompt, nothing to toggle).
 */
export function PrintPdfActions({
  printPath,
  filename,
  hasSignature,
  hasStamp,
  hasPhone,
  hasEmail,
}: {
  printPath: string;
  filename: string;
  hasSignature: boolean;
  hasStamp: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [includeStamp, setIncludeStamp] = useState(true);
  const [includePhone, setIncludePhone] = useState(true);
  const [includeEmail, setIncludeEmail] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!hasSignature && !hasStamp && !hasPhone && !hasEmail) {
    return (
      <div className="flex items-start gap-2">
        <a
          href={printPath}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap"
        >
          Print / PDF
        </a>
        <DownloadPdfButton printPath={printPath} filename={filename} />
      </div>
    );
  }

  function withParams(base: string) {
    const params = new URLSearchParams();
    if (hasSignature && includeSignature) params.set("signature", "1");
    if (hasStamp && includeStamp) params.set("stamp", "1");
    if (hasPhone && includePhone) params.set("phone", "1");
    if (hasEmail && includeEmail) params.set("email", "1");
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap"
      >
        Print / Download PDF
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink">Include on this document</p>
            {hasSignature && (
              <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={includeSignature}
                  onChange={(e) => setIncludeSignature(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Signature
              </label>
            )}
            {hasStamp && (
              <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={includeStamp}
                  onChange={(e) => setIncludeStamp(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Stamp
              </label>
            )}
            {hasPhone && (
              <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={includePhone}
                  onChange={(e) => setIncludePhone(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Phone
              </label>
            )}
            {hasEmail && (
              <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={includeEmail}
                  onChange={(e) => setIncludeEmail(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Email
              </label>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <a
              href={withParams(printPath)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink text-center hover:bg-surface-2 transition"
            >
              Open Print View
            </a>
            <DownloadPdfButton printPath={withParams(printPath)} filename={filename} />
          </div>
        </div>
      )}
    </div>
  );
}

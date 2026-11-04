"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { placePanel } from "@/lib/panelPosition";
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
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is drawn on <body> (position: fixed) so no card with overflow hidden around this button can cut it
  // off — on the Service Job page it used to be clipped and the "Download PDF" button inside it was out of reach.
  // It is placed from the button's measured position (see placePanel) and follows scroll/resize.
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0, visibility: "hidden" });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && !(panelRef.current && panelRef.current.contains(target))) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const btn = ref.current;
      const panel = panelRef.current;
      if (!btn || !panel) return;
      const r = btn.getBoundingClientRect();
      const { top, left } = placePanel(
        { top: r.top, bottom: r.bottom, right: r.right },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      setPanelStyle({ position: "fixed", top, left, visibility: "visible" });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

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
    if (!qs) return base;
    // `base` may already carry its own query string (every report print
    // path does — e.g. `?party_id=...`), unlike the 5 original document
    // print paths (`/invoices/[id]/print`) this component was first built
    // for, which never had one. Appending another bare `?` there would
    // corrupt the existing param (e.g. `?party_id=abc?signature=1` reads
    // back as party_id="abc?signature=1") — use `&` once `base` already
    // has a `?`.
    return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
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

      {open &&
        createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="z-50 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg space-y-3"
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}

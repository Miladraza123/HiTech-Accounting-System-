"use client";

import { useEffect, useState, useTransition } from "react";
import { uploadCompanyImageAction, removeCompanyImageAction, getCompanyImagePreviewUrlAction, type BrandingKind } from "@/app/actions/companyBranding";
import { buttonClass } from "@/components/ui/Button";

function BrandingSlot({ kind, label, hint, path }: { kind: BrandingKind; label: string; hint: string; path: string | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Deferred to a microtask rather than called directly in the effect
    // body (same pattern as OfflineQueueProvider/TwoFactorSettings) so
    // its state updates happen strictly after this render has committed.
    queueMicrotask(async () => {
      if (!path) {
        setPreviewUrl(null);
        setLoadingPreview(false);
        return;
      }
      setLoadingPreview(true);
      const url = await getCompanyImagePreviewUrlAction(path);
      setPreviewUrl(url);
      setLoadingPreview(false);
    });
  }, [path]);

  function handleUpload(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await uploadCompanyImageAction(kind, formData);
      if (res.error) setError(res.error);
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeCompanyImageAction(kind);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-bg p-3">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="text-xs text-ink-faint">{hint}</p>

      <div className="flex h-16 w-full items-center justify-center rounded border border-line bg-white">
        {loadingPreview ? (
          <span className="text-xs text-ink-faint">Loading…</span>
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed preview URL, not a static asset.
          <img src={previewUrl} alt={label} className="h-full max-w-full object-contain p-1" />
        ) : (
          <span className="text-xs text-ink-faint">Not uploaded</span>
        )}
      </div>

      <form action={handleUpload} className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" required className="text-xs w-full" />
        <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
          {pending ? "…" : path ? "Replace" : "Upload"}
        </button>
        {path && (
          <button type="button" onClick={handleRemove} disabled={pending} className="text-xs text-bad underline underline-offset-2 disabled:opacity-50">
            Remove
          </button>
        )}
      </form>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

export function CompanyBrandingForm({
  logoPath,
  signaturePath,
  stampPath,
}: {
  logoPath: string | null;
  signaturePath: string | null;
  stampPath: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <BrandingSlot kind="logo" label="Logo" hint="Shown on every printed document's letterhead." path={logoPath} />
      <BrandingSlot
        kind="signature"
        label="Signature"
        hint="Shown only when chosen at Print/Download time on a document."
        path={signaturePath}
      />
      <BrandingSlot kind="stamp" label="Stamp" hint="Shown only when chosen at Print/Download time on a document." path={stampPath} />
    </div>
  );
}

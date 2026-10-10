"use client";

import { useEffect, useState, useTransition } from "react";
import { uploadCompanyImageAction, removeCompanyImageAction, getCompanyImagePreviewUrlAction, type BrandingKind } from "@/app/actions/companyBranding";
import { autoCropLogo } from "@/lib/logoAutoCrop";
import { shrinkImageToFit } from "@/lib/shrinkImage";
import { buttonClass } from "@/components/ui/Button";

// Roughly enough to stay sharp printed at the sizes these are actually
// shown at (logo up to 45mm wide, signature/stamp similar) — a source
// image below this will look visibly soft once scaled up, regardless
// of how correctly the print CSS itself sizes the box.
const MIN_DIMENSION_PX = 150;

// Same cap the server enforces (companyBranding.ts). A bigger photo is scaled down here first.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

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

  async function handleUpload(formData: FormData) {
    setError(null);
    let file = formData.get("file");
    if (file instanceof File && file.type !== "image/svg+xml") {
      if (file.size > MAX_UPLOAD_BYTES) {
        // A phone photo is often 2 to 6 MB; scale it down instead of refusing it.
        const smaller = await shrinkImageToFit(file, MAX_UPLOAD_BYTES);
        if (!smaller) {
          setError("This image is too large and could not be reduced. Use a PNG or JPEG under 2MB.");
          return;
        }
        file = smaller;
        formData.set("file", file);
      }
      if (kind === "logo") {
        // Trims blank/transparent margin around the actual logo artwork
        // before it's ever stored — the print box (PrintLogoBlock.tsx)
        // alone can't fix a file that already has a lot of padding baked
        // in. Only applied to Logo, matching the reference approach this
        // was confirmed against.
        file = await autoCropLogo(file);
        formData.set("file", file);
      }
      // A correctly-sized print box can't fix a source image that's
      // just too low-resolution to begin with — it'll look soft once
      // scaled up. Checked client-side (natural pixel dimensions, after
      // any crop above) before even uploading; SVG is vector and has no
      // meaningful "resolution" to check.
      const isBanner = kind === "letterhead_footer";
      const dims = await readImageDimensions(file);
      if (dims && !isBanner && Math.min(dims.width, dims.height) < MIN_DIMENSION_PX) {
        setError(
          `This image is only ${dims.width}×${dims.height}px — too low-resolution to print sharply. Use an image at least ${MIN_DIMENSION_PX}×${MIN_DIMENSION_PX}px.`
        );
        return;
      }
    }
    startTransition(async () => {
      try {
        const res = await uploadCompanyImageAction(kind, formData);
        if (res.error) setError(res.error);
      } catch {
        // A thrown server-action error (network drop, request too large) would otherwise
        // reach the page's error boundary and replace the whole screen.
        setError("Upload failed. Check your connection and try again with a smaller image.");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await removeCompanyImageAction(kind);
        if (res.error) setError(res.error);
      } catch {
        setError("Could not remove the image. Try again.");
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-bg p-3">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="text-xs text-ink-faint">{hint}</p>

      <div className={`flex w-full items-center justify-center rounded border border-line bg-white ${kind === "letterhead_footer" ? "h-12" : "h-16"}`}>
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
  footerPath = null,
}: {
  logoPath: string | null;
  signaturePath: string | null;
  stampPath: string | null;
  footerPath?: string | null;
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
      <BrandingSlot
        kind="letterhead_footer"
        label="Letterhead Footer Banner"
        hint="Bottom banner of the Quotation and Service Invoice. The HiTech banner is used until you upload one. (The top of the page is built from the company details above.)"
        path={footerPath}
      />
    </div>
  );
}

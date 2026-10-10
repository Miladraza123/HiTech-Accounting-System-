// Client-side shrink for a branding image (Signature / Stamp) that is over the
// upload size cap. A phone photo is usually 2 to 6 MB; the server accepts up to
// MAX_BYTES, so a larger image is scaled down in the browser first instead of
// being refused (or, before this existed, crashing the page).
//
// Canvas API only, no dependency. Transparency is kept: PNG first, then WebP
// (which also keeps transparency), then JPEG as the last resort.

const MAX_DIMENSIONS = [1600, 1200, 900, 700];

function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Returns the file itself when it already fits, a smaller copy when it can be
 * made to fit, or null when it cannot (not a readable image, or still too big
 * after the smallest size).
 */
export async function shrinkImageToFit(file: File, maxBytes: number): Promise<File | null> {
  if (file.size <= maxBytes) return file;
  if (file.type === "image/svg+xml") return null; // vector: nothing to scale

  const img = await loadImage(file);
  if (!img) return null;

  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  const attempts: Array<{ type: string; ext: string; quality?: number }> = [
    { type: "image/png", ext: "png" },
    { type: "image/webp", ext: "webp", quality: 0.9 },
    { type: "image/jpeg", ext: "jpg", quality: 0.88 },
  ];

  for (const maxDim of MAX_DIMENSIONS) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const a of attempts) {
      const blob = await toBlob(canvas, a.type, a.quality);
      // toBlob falls back to PNG when a type is unsupported; skip a mismatch.
      if (blob && blob.type === a.type && blob.size <= maxBytes) {
        return new File([blob], `${base}.${a.ext}`, { type: a.type });
      }
    }
  }
  return null;
}

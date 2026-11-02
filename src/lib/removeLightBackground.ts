// Makes the light background of a scanned/photographed signature or stamp transparent, in the browser,
// before it is uploaded. A JPG (or a PNG saved with a white page behind it) otherwise prints as a pale
// box that hides whatever is under it, such as the signature line.
//
// Canvas API only, no dependency. Ink keeps its own colour (blue stamp, black pen); only how opaque a
// pixel is changes: the lighter it is, the more transparent. A file that already has real transparency
// is returned untouched, and so is anything that would end up (almost) blank.

const FULLY_TRANSPARENT_BELOW = 18; // darkness (255 - lightest channel) up to here -> transparent
const FULLY_OPAQUE_FROM = 90; // darkness from here -> fully opaque; in between it fades in

/** Opacity (0-255) for a pixel, from how dark its darkest channel is. */
export function alphaForPixel(r: number, g: number, b: number): number {
  const darkness = 255 - Math.min(r, g, b);
  if (darkness <= FULLY_TRANSPARENT_BELOW) return 0;
  if (darkness >= FULLY_OPAQUE_FROM) return 255;
  return Math.round(((darkness - FULLY_TRANSPARENT_BELOW) / (FULLY_OPAQUE_FROM - FULLY_TRANSPARENT_BELOW)) * 255);
}

/** Pure pixel pass over RGBA data (in place). Returns how many pixels end up visible and whether the image already had transparency. */
export function applyLightBackgroundRemoval(data: Uint8ClampedArray): { visible: number; total: number; hadTransparency: boolean } {
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return { visible: total, total, hadTransparency: true }; // real transparency already: leave as is
  }
  let visible = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = alphaForPixel(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = a;
    if (a > 0) visible++;
  }
  return { visible, total, hadTransparency: false };
}

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

/** Returns a PNG with the light background removed, or the original file when nothing should be changed. */
export async function removeLightBackground(file: File): Promise<File> {
  if (file.type === "image/svg+xml") return file; // vector art has its own transparency
  const img = await loadImage(file);
  if (!img) return file;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return file;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { visible, total, hadTransparency } = applyLightBackgroundRemoval(pixels.data);
  if (hadTransparency || visible < total * 0.002) return file; // already transparent, or it would come out blank
  ctx.putImageData(pixels, 0, 0);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.png`, { type: "image/png" });
}

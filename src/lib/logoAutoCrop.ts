// Client-side logo auto-crop, matching the exact approach confirmed from a
// reference system's own code (shrinkLogo/findContentBox): trims blank/
// transparent margin around the actual logo artwork before it's ever
// uploaded, so a fixed-size print box (see PrintLogoBlock.tsx) shows a
// consistently-filled logo no matter how much padding the original file
// had — the print CSS box size alone can never fix that; it has to be
// fixed at the source image.
//
// Runs entirely in the browser (Canvas API) — no new dependency, no
// server-side image processing. Only ever applied to the Logo upload,
// not Signature/Stamp.

const MAX_LOGO_DIMENSION = 420; // longest side, after cropping
const CONTENT_PADDING_FRACTION = 0.04; // ~4% breathing room kept around the trimmed content
const SCAN_MAX_DIMENSION = 1600; // cap the pixel-scan pass for speed on a large source photo/scan
const JPEG_QUALITY = 0.92;

function isBackgroundPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 10) return true; // fully/mostly transparent
  if (r > 250 && g > 250 && b > 250) return true; // near-white background
  return false;
}

function findContentBox(imageData: ImageData): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isBackgroundPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // the whole image looked like background
  return { minX, minY, maxX, maxY };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))), type, quality);
  });
}

function blobToFile(blob: Blob, originalName: string, ext: string): File {
  const base = originalName.replace(/\.[^.]+$/, "") || "logo";
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

/**
 * Returns a new File: the input image auto-cropped to its actual visible
 * content (blank/transparent margin trimmed, ~4% padding kept), capped to
 * 420px on its longest side, encoded as PNG if any transparency survived
 * the crop or otherwise as whichever of PNG/JPEG comes out smaller.
 *
 * Falls back to returning the original file untouched if anything about
 * this fails (e.g. a corrupt image, or a canvas operation the browser
 * refuses) — never blocks the upload over a best-effort enhancement.
 */
export async function autoCropLogo(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);

    const scanScale = Math.min(1, SCAN_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const scanW = Math.max(1, Math.round(bitmap.width * scanScale));
    const scanH = Math.max(1, Math.round(bitmap.height * scanScale));
    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = scanW;
    scanCanvas.height = scanH;
    const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
    if (!scanCtx) return file;
    scanCtx.drawImage(bitmap, 0, 0, scanW, scanH);

    const box = findContentBox(scanCtx.getImageData(0, 0, scanW, scanH));
    if (!box) return file;

    const toSrc = (v: number) => v / scanScale;
    const boxWidth = box.maxX - box.minX + 1;
    const boxHeight = box.maxY - box.minY + 1;
    const padX = Math.round(boxWidth * CONTENT_PADDING_FRACTION);
    const padY = Math.round(boxHeight * CONTENT_PADDING_FRACTION);

    const cropX = Math.max(0, Math.round(toSrc(box.minX - padX)));
    const cropY = Math.max(0, Math.round(toSrc(box.minY - padY)));
    const cropRight = Math.min(bitmap.width, Math.round(toSrc(box.maxX + 1 + padX)));
    const cropBottom = Math.min(bitmap.height, Math.round(toSrc(box.maxY + 1 + padY)));
    const cropWidth = Math.max(1, cropRight - cropX);
    const cropHeight = Math.max(1, cropBottom - cropY);

    const outScale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(cropWidth, cropHeight));
    const outWidth = Math.max(1, Math.round(cropWidth * outScale));
    const outHeight = Math.max(1, Math.round(cropHeight * outScale));

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outWidth;
    outCanvas.height = outHeight;
    const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
    if (!outCtx) return file;
    outCtx.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, outWidth, outHeight);
    bitmap.close?.();

    const outData = outCtx.getImageData(0, 0, outWidth, outHeight).data;
    let hasTransparency = false;
    for (let i = 3; i < outData.length; i += 4) {
      if (outData[i] < 255) {
        hasTransparency = true;
        break;
      }
    }

    const pngBlob = await canvasToBlob(outCanvas, "image/png");
    if (hasTransparency) return blobToFile(pngBlob, file.name, "png");

    const jpegBlob = await canvasToBlob(outCanvas, "image/jpeg", JPEG_QUALITY);
    return jpegBlob.size < pngBlob.size ? blobToFile(jpegBlob, file.name, "jpg") : blobToFile(pngBlob, file.name, "png");
  } catch {
    return file;
  }
}

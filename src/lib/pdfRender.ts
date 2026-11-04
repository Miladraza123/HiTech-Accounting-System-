import { PRINT_FONT } from "@/lib/printFont";

// Turns a print document (loaded in a hidden iframe) into a canvas for the PDF download.
//
// Primary engine: html-to-image. It hands the page to the browser's own layout/text engine (an SVG
// <foreignObject>), the same engine that produces "Print View", so every piece of text lands exactly where
// the page puts it — inside its cell, not on its border. The print font is embedded as data URLs because an
// SVG image cannot load fonts from the network.
//
// Fallback engine: html2canvas, which redraws the page itself and places text by its own estimate of the
// baseline (a few pixels low, so text touches the lines under it). It is used only when the primary engine
// fails or returns a blank page, and lifts the text in cells to compensate.

const FONT_FILES: { weight: number; style: "normal" | "italic" }[] = [
  { weight: 400, style: "normal" },
  { weight: 700, style: "normal" },
  { weight: 400, style: "italic" },
  { weight: 700, style: "italic" },
];

/** @font-face rules with the font files inlined, for the SVG the browser draws the page from. */
export function buildFontEmbedCss(faces: { weight: number; style: string; dataUrl: string }[]): string {
  return faces
    .map((f) => `@font-face { font-family: "${PRINT_FONT}"; font-style: ${f.style}; font-weight: ${f.weight}; src: url(${f.dataUrl}) format("woff2"); }`)
    .join("\n");
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let fontEmbedCache: Promise<string> | null = null;

/** Fetches the shipped font files once and returns the embed CSS (empty if none could be fetched). */
export function loadFontEmbedCss(): Promise<string> {
  fontEmbedCache ??= (async () => {
    const faces: { weight: number; style: string; dataUrl: string }[] = [];
    await Promise.all(
      FONT_FILES.map(async (f) => {
        try {
          const res = await fetch(`/fonts/carlito-latin-${f.weight}-${f.style}.woff2`);
          if (!res.ok) return;
          const bytes = new Uint8Array(await res.arrayBuffer());
          faces.push({ weight: f.weight, style: f.style, dataUrl: `data:font/woff2;base64,${bytesToBase64(bytes)}` });
        } catch {
          /* skip this face */
        }
      })
    );
    return buildFontEmbedCss(faces);
  })();
  return fontEmbedCache;
}

/** True when a downscaled RGBA sample of the canvas holds real content (not a blank or all-white page). */
export function sampleLooksRendered(rgba: Uint8ClampedArray, minInkRatio = 0.01): boolean {
  const pixels = rgba.length / 4;
  if (pixels === 0) return false;
  let ink = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a > 8 && (rgba[i] < 240 || rgba[i + 1] < 240 || rgba[i + 2] < 240)) ink++;
  }
  return ink / pixels >= minInkRatio;
}

function canvasLooksRendered(canvas: HTMLCanvasElement): boolean {
  if (canvas.width < 100 || canvas.height < 100) return false;
  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = Math.max(1, Math.round((64 * canvas.height) / canvas.width));
  const ctx = probe.getContext("2d");
  if (!ctx) return true; // cannot check: trust the engine
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, probe.width, probe.height);
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
  return sampleLooksRendered(ctx.getImageData(0, 0, probe.width, probe.height).data);
}

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function renderWithBrowserEngine(body: HTMLElement): Promise<HTMLCanvasElement | null> {
  const { toCanvas } = await import("html-to-image");
  const options = {
    pixelRatio: 2,
    width: body.scrollWidth,
    height: body.scrollHeight,
    backgroundColor: "#ffffff",
    fontEmbedCSS: await loadFontEmbedCss(),
    includeQueryParams: true,
    imagePlaceholder: TRANSPARENT_PIXEL,
    cacheBust: false,
  };
  // Safari draws images late on the first pass of an SVG render; a throw-away first pass warms them up.
  if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) await toCanvas(body, options).catch(() => null);
  const canvas = await withTimeout(toCanvas(body, options), 30000);
  return canvasLooksRendered(canvas) ? canvas : null;
}

/** Shifts the text of table cells up by half of `extraPx` (cells are vertically centred), for the fallback engine. */
export function liftCellText(doc: Document, extraPx = 3): void {
  const view = doc.defaultView;
  if (!view) return;
  doc.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
    const bottom = parseFloat(view.getComputedStyle(cell).paddingBottom) || 0;
    cell.style.paddingBottom = `${bottom + extraPx}px`;
  });
}

async function renderWithHtml2canvas(body: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas");
  return html2canvas(body, {
    scale: 2,
    useCORS: true,
    windowWidth: body.scrollWidth,
    windowHeight: body.scrollHeight,
    onclone: (clonedDoc) => liftCellText(clonedDoc),
  });
}

export type PrintRender = { canvas: HTMLCanvasElement; engine: "browser" | "fallback" };

/** Draws the print document that is loaded in `iframe`; never fails because one engine did. */
export async function renderPrintDocument(iframe: HTMLIFrameElement, opts: { forceFallback?: boolean } = {}): Promise<PrintRender> {
  const body = iframe.contentDocument?.body;
  if (!body) throw new Error("Couldn't read the document content.");
  if (!opts.forceFallback) {
    try {
      const canvas = await renderWithBrowserEngine(body);
      if (canvas) return { canvas, engine: "browser" };
    } catch {
      /* fall through to the second engine */
    }
  }
  return { canvas: await renderWithHtml2canvas(body), engine: "fallback" };
}

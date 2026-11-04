import { PRINT_FONT } from "@/lib/printFont";

const FILES: { weight: number; style: "normal" | "italic" }[] = [
  { weight: 400, style: "normal" },
  { weight: 700, style: "normal" },
  { weight: 400, style: "italic" },
  { weight: 700, style: "italic" },
];

/**
 * Makes the print font available to THIS page (not just to the print document in the hidden iframe).
 *
 * html2canvas runs here, in the app page, and draws on a canvas created here; the print page lives in an
 * iframe whose own @font-face the canvas cannot see. Without this the canvas falls back to a wider system
 * font while the positions come from the print font, so words run into each other in the downloaded PDF.
 * Safe to call repeatedly; a font that cannot be loaded is skipped (the PDF then falls back as before).
 */
export async function ensurePrintFontLoaded(doc: Document = document): Promise<void> {
  if (typeof FontFace === "undefined" || !doc.fonts) return;
  const loaded = new Set([...doc.fonts].filter((f) => f.family.replace(/["']/g, "") === PRINT_FONT && f.status === "loaded").map((f) => `${f.weight}-${f.style}`));
  await Promise.all(
    FILES.filter((f) => !loaded.has(`${f.weight}-${f.style}`)).map(async (f) => {
      try {
        const face = new FontFace(PRINT_FONT, `url(/fonts/carlito-latin-${f.weight}-${f.style}.woff2) format("woff2")`, { weight: String(f.weight), style: f.style });
        await face.load();
        doc.fonts.add(face);
      } catch {
        /* keep going: the other weights may still load */
      }
    })
  );
}

type FaceInfo = { family: string; weight: string; style: string; status: string };

/** True when both the regular and the bold upright face of the print font are loaded in this page. */
export function printFontReady(faces: FaceInfo[]): boolean {
  const loaded = faces.filter((f) => f.family.replace(/["']/g, "") === PRINT_FONT && f.status === "loaded" && f.style === "normal");
  const has = (w: string) => loaded.some((f) => f.weight === w);
  return has("400") && has("700");
}

/** Whether this page can really draw text in the print font (see ensurePrintFontLoaded). */
export function isPrintFontLoaded(doc: Document = document): boolean {
  return !!doc.fonts && printFontReady([...doc.fonts]);
}

/**
 * Last resort when the print font could not be loaded into this page: switch the print document to plain
 * system fonts, so the PDF is drawn in the very font the page was laid out with. A mismatch between the two
 * is what makes words run together; consistent system fonts at worst leave the text a pixel or two off.
 */
export function switchToSystemFonts(printDoc: Document): void {
  const style = printDoc.createElement("style");
  style.textContent = 'html, body, body * { font-family: Arial, Helvetica, sans-serif !important; }';
  printDoc.head.appendChild(style);
}

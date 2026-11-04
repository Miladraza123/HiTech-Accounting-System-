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

// The font every printed / downloaded document is drawn in.
//
// Carlito (free, metric-compatible with Calibri, SIL OFL licence; files in /public/fonts) is shipped with the
// page. Without it each phone or PC falls back to its own system font, and the PDF download — which redraws
// the page with html2canvas — then placed text a few pixels away from where the page had laid it out, so cell
// borders cut through it. With one embedded font the page and the redraw agree on every device.
export const PRINT_FONT = "HiTech Carlito";

/** The CSS font stack: the embedded font first, the old system fonts as a fallback. */
export const PRINT_FONT_STACK = `"${PRINT_FONT}", Calibri, Carlito, "Segoe UI", ui-sans-serif, system-ui, sans-serif`;

/** @font-face rules for the four shipped files. `font-display: block` so a print is never drawn in a fallback first. */
export function printFontFaces(): string {
  const face = (weight: number, style: "normal" | "italic") =>
    `@font-face { font-family: "${PRINT_FONT}"; font-style: ${style}; font-weight: ${weight}; font-display: block; src: url("/fonts/carlito-latin-${weight}-${style}.woff2") format("woff2"); }`;
  return [face(400, "normal"), face(700, "normal"), face(400, "italic"), face(700, "italic")].join("\n    ");
}

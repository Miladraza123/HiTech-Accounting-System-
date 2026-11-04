import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gstInvoicePrintStyles } from "./gstInvoicePrintStyles";
import { AUTO_PRINT_SCRIPT } from "./printStyles";

describe("GST invoice stylesheet", () => {
  const css = gstInvoicePrintStyles("print-gst-invoice-lh");
  it("ships its own font: four @font-face rules whose files exist in /public/fonts", () => {
    const urls = [...css.matchAll(/url\("\/fonts\/([^"]+\.woff2)"\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(["carlito-latin-400-italic.woff2", "carlito-latin-400-normal.woff2", "carlito-latin-700-italic.woff2", "carlito-latin-700-normal.woff2"]);
    for (const f of urls) expect(existsSync(join(__dirname, "../../public/fonts", f))).toBe(true);
    expect(existsSync(join(__dirname, "../../public/fonts/Carlito-OFL.txt"))).toBe(true);
  });
  it("uses it for the invoice, with the old system fonts as fallback, and never swaps fonts mid-render", () => {
    expect(css).toContain('.print-gst-invoice-lh { font-family: "HiTech Carlito", Calibri');
    expect(css).toContain("font-display: block");
  });
});

describe("AUTO_PRINT_SCRIPT", () => {
  it("still skips with autoprint=0 and now waits for web fonts before printing", () => {
    expect(AUTO_PRINT_SCRIPT).toContain("autoprint");
    expect(AUTO_PRINT_SCRIPT).toContain("document.fonts.ready");
    expect(AUTO_PRINT_SCRIPT).toContain("window.print()");
  });
});

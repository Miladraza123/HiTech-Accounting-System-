import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PRINT_FONT, PRINT_FONT_STACK, printFontFaces } from "./printFont";
import { letterheadPrintStyles } from "./letterheadPrintStyles";
import { dcPrintStyles } from "./dcPrintStyles";
import { printStyles, AUTO_PRINT_SCRIPT } from "./printStyles";
import { gstInvoicePrintStyles } from "./gstInvoicePrintStyles";

describe("shared print font", () => {
  it("ships four @font-face rules whose files and licence exist in /public/fonts", () => {
    const urls = [...printFontFaces().matchAll(/url\("\/fonts\/([^"]+\.woff2)"\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(["carlito-latin-400-italic.woff2", "carlito-latin-400-normal.woff2", "carlito-latin-700-italic.woff2", "carlito-latin-700-normal.woff2"]);
    for (const f of urls) expect(existsSync(join(__dirname, "../../public/fonts", f))).toBe(true);
    expect(existsSync(join(__dirname, "../../public/fonts/Carlito-OFL.txt"))).toBe(true);
    expect(printFontFaces()).toContain("font-display: block");
  });
  it("puts the embedded font first and keeps the old system fonts as fallback", () => {
    expect(PRINT_FONT_STACK.startsWith(`"${PRINT_FONT}", Calibri`)).toBe(true);
    expect(PRINT_FONT_STACK).toContain("system-ui");
  });
  it("is used by every printed document stylesheet", () => {
    for (const css of [letterheadPrintStyles("s"), dcPrintStyles("s"), printStyles("s"), gstInvoicePrintStyles("s") + letterheadPrintStyles("s")]) {
      expect(css).toContain("@font-face");
      expect(css).toContain(PRINT_FONT_STACK);
    }
  });
});

describe("AUTO_PRINT_SCRIPT", () => {
  it("still skips with autoprint=0 and waits for web fonts before printing", () => {
    expect(AUTO_PRINT_SCRIPT).toContain("autoprint");
    expect(AUTO_PRINT_SCRIPT).toContain("document.fonts.ready");
    expect(AUTO_PRINT_SCRIPT).toContain("window.print()");
  });
});

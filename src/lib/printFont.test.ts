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

import { printFontReady } from "./printFontClient";

describe("printFontReady", () => {
  const face = (weight: string, style = "normal", status = "loaded", family = '"HiTech Carlito"') => ({ family, weight, style, status });
  it("needs both the regular and the bold upright face to be loaded", () => {
    expect(printFontReady([face("400"), face("700")])).toBe(true);
    expect(printFontReady([face("400")])).toBe(false);
    expect(printFontReady([face("700")])).toBe(false);
  });
  it("ignores faces that are still loading, failed, italic or another family", () => {
    expect(printFontReady([face("400", "normal", "loading"), face("700")])).toBe(false);
    expect(printFontReady([face("400", "normal", "error"), face("700")])).toBe(false);
    expect(printFontReady([face("400", "italic"), face("700", "italic")])).toBe(false);
    expect(printFontReady([face("400", "normal", "loaded", "Roboto"), face("700", "normal", "loaded", "Roboto")])).toBe(false);
    expect(printFontReady([])).toBe(false);
  });
  it("accepts the family name with or without quotes", () => {
    expect(printFontReady([face("400", "normal", "loaded", "HiTech Carlito"), face("700", "normal", "loaded", "HiTech Carlito")])).toBe(true);
  });
});

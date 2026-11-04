import { describe, expect, it } from "vitest";
import { buildFontEmbedCss, sampleLooksRendered } from "./pdfRender";

describe("buildFontEmbedCss", () => {
  it("emits one @font-face per face with inlined data", () => {
    const css = buildFontEmbedCss([
      { weight: 400, style: "normal", dataUrl: "data:font/woff2;base64,AAA" },
      { weight: 700, style: "italic", dataUrl: "data:font/woff2;base64,BBB" },
    ]);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("font-weight: 700; src: url(data:font/woff2;base64,BBB)");
    expect(css).toContain("font-style: italic");
  });
});

describe("sampleLooksRendered", () => {
  it("rejects an empty or all-white sample", () => {
    expect(sampleLooksRendered(new Uint8ClampedArray(0))).toBe(false);
    expect(sampleLooksRendered(new Uint8ClampedArray(400).fill(255))).toBe(false);
    expect(sampleLooksRendered(new Uint8ClampedArray(400))).toBe(false); // transparent
  });
  it("accepts a sample with dark ink", () => {
    const px = new Uint8ClampedArray(4 * 100).fill(255);
    for (let i = 0; i < 5; i++) { px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; }
    expect(sampleLooksRendered(px)).toBe(true);
  });
});

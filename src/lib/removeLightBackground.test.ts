import { describe, it, expect } from "vitest";
import { alphaForPixel, applyLightBackgroundRemoval } from "./removeLightBackground";

function rgba(...px: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flatMap((p) => [p[0], p[1], p[2], p[3] ?? 255]));
}

describe("alphaForPixel", () => {
  it("makes white and near-white paper transparent", () => {
    expect(alphaForPixel(255, 255, 255)).toBe(0);
    expect(alphaForPixel(245, 246, 248)).toBe(0); // the faint grey of a scanned page
  });
  it("keeps dark ink and coloured ink fully opaque", () => {
    expect(alphaForPixel(10, 10, 10)).toBe(255);
    expect(alphaForPixel(30, 60, 160)).toBe(255); // blue stamp / pen
  });
  it("fades in between, never going backwards as it gets darker", () => {
    let last = -1;
    for (let v = 255; v >= 100; v -= 5) {
      const a = alphaForPixel(v, v, v);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
  });
});

describe("applyLightBackgroundRemoval", () => {
  it("clears the paper, keeps the ink, and reports how much is visible", () => {
    const data = rgba([255, 255, 255], [250, 250, 250], [20, 20, 20], [40, 70, 170]);
    const r = applyLightBackgroundRemoval(data);
    expect(Array.from(data).filter((_, i) => i % 4 === 3)).toEqual([0, 0, 255, 255]);
    expect(r).toEqual({ visible: 2, total: 4, hadTransparency: false });
    // colours are left alone
    expect(Array.from(data.slice(8, 11))).toEqual([20, 20, 20]);
  });
  it("leaves an image that already has transparency exactly as it is", () => {
    const data = rgba([255, 255, 255, 0], [10, 10, 10, 255]);
    const before = Array.from(data);
    const r = applyLightBackgroundRemoval(data);
    expect(r.hadTransparency).toBe(true);
    expect(Array.from(data)).toEqual(before);
  });
});

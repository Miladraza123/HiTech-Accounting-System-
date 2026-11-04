import { describe, it, expect } from "vitest";
import { placePanel } from "./panelPosition";

const viewport = { width: 390, height: 800 };
const panel = { width: 256, height: 150 };

describe("placePanel", () => {
  it("sits under the button, right-aligned to it", () => {
    const p = placePanel({ top: 100, bottom: 130, right: 370 }, panel, viewport);
    expect(p).toEqual({ top: 138, left: 114 });
  });
  it("is clamped into the screen when the button is near the left edge", () => {
    const p = placePanel({ top: 100, bottom: 130, right: 120 }, panel, viewport);
    expect(p.left).toBe(12);
  });
  it("is clamped when the button is wider than the room on the right", () => {
    const p = placePanel({ top: 100, bottom: 130, right: 600 }, panel, viewport);
    expect(p.left).toBe(390 - 256 - 12);
  });
  it("flips above the button when there is no room below", () => {
    const p = placePanel({ top: 700, bottom: 730, right: 380 }, panel, viewport);
    expect(p.top).toBe(700 - 8 - 150);
  });
  it("stays below when it fits neither way (short screen)", () => {
    const p = placePanel({ top: 40, bottom: 70, right: 380 }, panel, { width: 390, height: 200 });
    expect(p.top).toBe(78);
  });
});

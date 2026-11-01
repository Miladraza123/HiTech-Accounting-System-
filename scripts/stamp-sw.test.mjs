import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stampServiceWorker } from "./stamp-sw.mjs";

const real = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");

describe("stampServiceWorker", () => {
  it("writes the commit id into BUILD_ID and changes nothing else", () => {
    const { code, reason } = stampServiceWorker(real, "a1b2c3d4e5f6");
    expect(reason).toBeNull();
    expect(code).toContain('const BUILD_ID = "a1b2c3d4e5f6";');
    expect(code.replace(/const BUILD_ID = "[^"]*";/, "")).toBe(real.replace(/const BUILD_ID = "[^"]*";/, ""));
  });
  it("gives different bytes for different deploys, same bytes for the same deploy", () => {
    const a = stampServiceWorker(real, "aaa111").code;
    expect(stampServiceWorker(real, "bbb222").code).not.toBe(a);
    expect(stampServiceWorker(real, "aaa111").code).toBe(a);
  });
  it("leaves the cache version alone", () => {
    expect(stampServiceWorker(real, "abc").code).toMatch(/const CACHE_VERSION = "v\d+";/);
  });
  it("skips without an id (local build) and refuses an unsafe id", () => {
    expect(stampServiceWorker(real, "").code).toBeNull();
    expect(stampServiceWorker(real, '";alert(1);//').code).toBeNull();
  });
  it("skips when the marker is missing", () => {
    expect(stampServiceWorker("const x = 1;", "abc").code).toBeNull();
  });
});

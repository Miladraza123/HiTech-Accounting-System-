import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESTORE_TABLE_ORDER } from "./restoreTableOrder";

describe("RESTORE_TABLE_ORDER", () => {
  it("matches backup/backup.js TABLE_ORDER exactly (kept in sync by hand)", () => {
    const src = readFileSync(join(__dirname, "../../backup/backup.js"), "utf8");
    const block = src.slice(src.indexOf("const TABLE_ORDER = ["), src.indexOf("];", src.indexOf("const TABLE_ORDER = [")));
    const tables = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(tables).toEqual([...RESTORE_TABLE_ORDER]);
  });

  it("lists every HR table once", () => {
    const hr = RESTORE_TABLE_ORDER.filter((t) => t.startsWith("hr_"));
    expect(hr).toHaveLength(13);
    expect(new Set(RESTORE_TABLE_ORDER).size).toBe(RESTORE_TABLE_ORDER.length);
  });
});

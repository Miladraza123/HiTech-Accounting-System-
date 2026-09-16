// Verification for the daily backup's restore file.
//
// The restore file is written to disk a row at a time rather than built as one
// JSON.stringify() string, because on the load-test dataset (1.3 million rows)
// stringifying the whole document threw "Invalid string length" — V8 caps a
// single string at about 512 MB. These tests prove the streamed file is the
// same document the in-app Restore feature expects.
import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "BACKUP_EMAIL", "BACKUP_PASSWORD", "GMAIL_USER", "GMAIL_APP_PASSWORD", "BACKUP_TO_EMAIL"]) {
  process.env[name] = process.env[name] || "test";
}
const { TABLE_ORDER, fetchTable, fetchAll, buildRestoreJson, writeRestoreJson, composeEmail, formatBytes } = require_("./backup.js");

const SAMPLE = {
  parties: [
    { id: "p1", legal_name: "Zenith Engineering", credit_limit: 100000, is_active: true, ntn: null },
    { id: "p2", legal_name: 'Quote "Co", Ltd', credit_limit: 0, is_active: false, ntn: "1234567-8" },
  ],
  invoices: [{ id: "i1", invoice_no: "INV-1", grand_total: 12980, party_id: "p1", cancel_reason: null }],
  items: [],
  // Unicode and newlines must survive the row-at-a-time write.
  queries: [{ id: "q1", requirement: "MS Pipe — 2\" x 6m\nurgent", notes: "کام" }],
};

const MISSED = [{ table: "audit_log", reason: "permission denied" }];

describe("writeRestoreJson", () => {
  let filePath;
  let parsed;
  let expected;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    filePath = path.join(dir, "restore.json");
    const bytes = await writeRestoreJson(SAMPLE, MISSED, "2026-09-16", filePath);
    expect(bytes).toBe(fs.statSync(filePath).size);
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    // buildRestoreJson() attaches whatever table map it is handed, verbatim.
    // fetchAll() always hands it every table (an empty array for one that has
    // no rows), so that is the map to compare against — and the streamed file
    // normalises a partial map to the same shape, which the next test pins.
    expected = buildRestoreJson(
      Object.fromEntries(TABLE_ORDER.map((t) => [t, SAMPLE[t] ?? []])),
      MISSED,
      "2026-09-16"
    );
  });

  it("writes a file the in-app Restore feature accepts", () => {
    expect(parsed.format).toBe("hitech-restore");
    expect(parsed.version).toBe(1);
    expect(typeof parsed.tables).toBe("object");
  });

  it("carries every table in TABLE_ORDER, including ones absent from the input", () => {
    expect(parsed.order).toEqual(TABLE_ORDER);
    for (const table of TABLE_ORDER) expect(Array.isArray(parsed.tables[table])).toBe(true);
    // SAMPLE holds only four tables; the rest must still be present as [] so a
    // restore never has to tell "no rows" apart from "this key is missing".
    expect(Object.keys(parsed.tables).sort()).toEqual([...TABLE_ORDER].sort());
    expect(parsed.tables.vehicles).toEqual([]);
    expect(parsed.counts.vehicles).toBe(0);
  });

  it("round-trips to exactly what buildRestoreJson() describes", () => {
    // taken_at is a fresh timestamp on each call, so it cannot match.
    delete parsed.taken_at;
    delete expected.taken_at;
    // buildRestoreJson() is handed the same tables, so counts and rows must agree.
    expect(parsed.counts).toEqual(expected.counts);
    expect(parsed.missed).toEqual(expected.missed);
    expect(parsed.missed_detail).toEqual(expected.missed_detail);
    expect(parsed.tables).toEqual(expected.tables);
    expect(parsed).toEqual({ ...expected, tables: parsed.tables });
  });

  it("preserves quotes, newlines and non-Latin text inside row values", () => {
    expect(parsed.tables.parties[1].legal_name).toBe('Quote "Co", Ltd');
    expect(parsed.tables.queries[0].requirement).toBe('MS Pipe — 2" x 6m\nurgent');
    expect(parsed.tables.queries[0].notes).toBe("کام");
  });

  it("keeps nulls and falsy values rather than dropping them", () => {
    expect(parsed.tables.parties[0].ntn).toBeNull();
    expect(parsed.tables.parties[1].is_active).toBe(false);
    expect(parsed.tables.parties[1].credit_limit).toBe(0);
  });
});

describe("formatBytes", () => {
  it("reports sizes the way the alert email reads them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });
});

describe("composeEmail", () => {
  const small = { filename: "HiTech-Backup.xlsx", path: "/tmp/a.xlsx", bytes: 2 * 1024 * 1024, description: "human-readable" };
  const huge = { filename: "HiTech-Restore.json", path: "/tmp/a.json", bytes: 540 * 1024 * 1024, description: "restore file" };
  const limit = 20 * 1024 * 1024;

  it("attaches both files and says nothing alarming on a normal run", () => {
    const m = composeEmail({ dateStr: "2026-09-16", missed: [], files: [small, { ...huge, bytes: 900 * 1024 }], maxBytes: limit });
    expect(m.subject).toBe("HiTech Daily Backup — 2026-09-16");
    expect(m.attachments).toHaveLength(2);
    expect(m.undeliverable).toBe(false);
    expect(m.text).not.toContain("⚠");
  });

  it("drops an oversized file, keeps the rest, and says so", () => {
    const m = composeEmail({ dateStr: "2026-09-16", missed: [], files: [small, huge], maxBytes: limit });
    expect(m.undeliverable).toBe(true);
    expect(m.subject).toContain("⚠ NOT ATTACHED");
    // The one that fits is still delivered.
    expect(m.attachments).toEqual([{ filename: small.filename, path: small.path }]);
    expect(m.text).toContain("HiTech-Restore.json — 540.0 MB");
    expect(m.text).toContain("TOO LARGE");
    // It must not claim the backup itself failed — it did not.
    expect(m.text).toContain("was taken and is complete");
  });

  it("reports a workbook that could not be built without hiding the restore file", () => {
    const m = composeEmail({
      dateStr: "2026-09-16",
      missed: [],
      files: [{ ...huge, bytes: 1024 }],
      workbookError: "JavaScript heap out of memory",
      maxBytes: limit,
    });
    expect(m.subject).toContain("⚠ NOT ATTACHED");
    expect(m.attachments).toHaveLength(1);
    expect(m.text).toContain("JavaScript heap out of memory");
    expect(m.text).toContain("The restore file is unaffected");
  });

  it("still leads with INCOMPLETE when a table failed to back up", () => {
    const m = composeEmail({
      dateStr: "2026-09-16",
      missed: [{ table: "audit_log", reason: "permission denied" }],
      files: [small, huge],
      maxBytes: limit,
    });
    expect(m.subject).toContain("⚠ INCOMPLETE");
    expect(m.text).toContain("audit_log: permission denied");
    // and the size problem is still reported in the same message
    expect(m.text).toContain("TOO LARGE");
  });
});

// A stand-in for the PostgREST client, recording what was asked for. The real
// one is not reachable from a unit test, and the point here is the paging
// arithmetic and the ordering, which is exactly what a silent truncation bug
// would hide.
function fakeSupabase(rowsByTable, { cap = 1000, failTable = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const order = [];
      const builder = {
        select() {
          return builder;
        },
        order(column) {
          order.push(column);
          return builder;
        },
        async range(from, to) {
          calls.push({ table, from, to, order: [...order] });
          if (table === failTable) return { data: null, error: { message: "permission denied" } };
          const all = rowsByTable[table] ?? [];
          const size = Math.min(to - from + 1, cap);
          return { data: all.slice(from, from + size), error: null };
        },
      };
      return builder;
    },
  };
}

describe("fetchTable", () => {
  it("keeps paging until a short page arrives, and returns every row in order", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const db = fakeSupabase({ invoice_lines: rows });
    const got = await fetchTable(db, "invoice_lines");
    expect(got).toHaveLength(2500);
    expect(got.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    // A short page no longer ends the loop: a short answer and a
    // server-capped answer look identical, so only an empty page is trusted as
    // the end of the table. That costs one extra request per table.
    expect(db.calls.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
  });

  it("orders by the primary key so pages cannot overlap or skip", async () => {
    const db = fakeSupabase({ invoices: [] });
    await fetchTable(db, "invoices");
    expect(db.calls[0].order).toEqual(["id"]);

    const db2 = fakeSupabase({ user_roles: [] });
    await fetchTable(db2, "user_roles");
    expect(db2.calls[0].order).toEqual(["user_id", "role_id"]);

    const db3 = fakeSupabase({ units: [] });
    await fetchTable(db3, "units");
    expect(db3.calls[0].order).toEqual(["code"]);
  });

  it("stops after one page when the table is exactly empty", async () => {
    const db = fakeSupabase({ vehicles: [] });
    expect(await fetchTable(db, "vehicles")).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });

  it("stops on an exact multiple of the page size only after an empty page", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const db = fakeSupabase({ items: rows });
    expect(await fetchTable(db, "items")).toHaveLength(2000);
    expect(db.calls).toHaveLength(3);
  });

  it("loses nothing when the server caps a page smaller than was asked for", async () => {
    // This is the dangerous case a backup must not get wrong: a server-side
    // db-max-rows smaller than our page size answers every request short. If
    // paging stepped by the REQUESTED size it would step over the rows that
    // were never sent and the backup would come back quietly incomplete.
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    const db = fakeSupabase({ parties: rows }, { cap: 400 });
    const got = await fetchTable(db, "parties");
    expect(got).toHaveLength(1500);
    expect(got.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(db.calls.map((c) => c.from)).toEqual([0, 400, 800, 1200, 1500]);
  });
});

describe("fetchAll", () => {
  it("records a failing table instead of aborting the whole backup", async () => {
    const db = fakeSupabase({ parties: [{ id: "p1" }] }, { failTable: "audit_log" });
    const { tables, missed } = await fetchAll(db);
    expect(tables.parties).toEqual([{ id: "p1" }]);
    expect(tables.audit_log).toEqual([]);
    expect(missed).toEqual([{ table: "audit_log", reason: "permission denied" }]);
  });
});

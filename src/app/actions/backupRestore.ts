"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { RESTORE_TABLE_ORDER } from "@/lib/restoreTableOrder";
import type { Json } from "@/lib/supabase/database.types";

export type ActionResult = { error: string | null };

const NO_PERMISSION: ActionResult = { error: "Only the Owner can use the Backup/Restore feature." };

// Shape of the JSON file backup.js (and getSafetySnapshotAction below) produce.
type RestoreFile = {
  format: string;
  version: number;
  taken_at?: string;
  taken_at_karachi?: string;
  data_date?: string;
  order: string[];
  missed?: string[];
  counts: Record<string, number>;
  tables: Record<string, Json[]>;
};

function parseRestoreFile(fileText: string): { file: RestoreFile } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { error: "This is not a valid JSON file." };
  }
  const file = parsed as Partial<RestoreFile>;
  if (file.format !== "hitech-restore") {
    return { error: `This file doesn't look like a restore file for this system (format: "${String(file.format)}").` };
  }
  if (file.version !== 1) {
    return { error: `This file's version (${String(file.version)}) is not supported by this app.` };
  }
  if (!file.tables || typeof file.tables !== "object") {
    return { error: "No 'tables' data found in the file." };
  }
  return { file: file as RestoreFile };
}

export type RestorePlanRow = {
  table: string;
  incoming: number;
  to_add: number;
  to_update: number;
  existing_total: number;
  to_delete_if_replace: number;
  error?: string;
};

export type RestorePlanResult = ActionResult & {
  meta?: { data_date?: string; taken_at_karachi?: string; missed?: string[] };
  plan?: RestorePlanRow[];
};

export async function getRestorePlanAction(fileText: string): Promise<RestorePlanResult> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return NO_PERMISSION;

  const parsed = parseRestoreFile(fileText);
  if ("error" in parsed) return { error: parsed.error };
  const { file } = parsed;

  const supabase = await createClient();
  const plan: RestorePlanRow[] = [];
  for (const table of RESTORE_TABLE_ORDER) {
    const rows = file.tables[table] ?? [];
    const { data, error } = await supabase.rpc("fn_admin_restore_plan", { p_table_name: table, p_rows: rows });
    if (error) {
      plan.push({ table, incoming: rows.length, to_add: 0, to_update: 0, existing_total: 0, to_delete_if_replace: 0, error: error.message });
    } else {
      plan.push(data as unknown as RestorePlanRow);
    }
  }

  return {
    error: null,
    meta: { data_date: file.data_date, taken_at_karachi: file.taken_at_karachi, missed: file.missed },
    plan,
  };
}

export type RestoreTableOutcome = { table: string; ok: boolean; deleted?: number; added_or_updated?: number; error?: string };
export type RestoreCommitResult = ActionResult & { outcomes?: RestoreTableOutcome[] };

export async function commitRestoreAction(fileText: string, mode: "merge" | "replace"): Promise<RestoreCommitResult> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return NO_PERMISSION;

  const parsed = parseRestoreFile(fileText);
  if ("error" in parsed) return { error: parsed.error };
  const { file } = parsed;

  const supabase = await createClient();
  const outcomes: RestoreTableOutcome[] = [];

  if (mode === "replace") {
    // Replace deletes every row the file doesn't contain, so a table absent
    // from the file, or one the backup failed to fetch (written as [] and
    // listed in `missed`), would be wiped entirely. Only a complete file may
    // drive a Replace; Merge never deletes and stays available.
    const missed = new Set(file.missed ?? []);
    const incomplete = RESTORE_TABLE_ORDER.filter((t) => !Array.isArray(file.tables[t]) || missed.has(t));
    if (incomplete.length) {
      return {
        error: `Replace refused: this file is incomplete (${incomplete.join(", ")}) — those tables would be wiped. Use Merge, or a complete backup file.`,
      };
    }

    // Orphan deletes go children-before-parents so a child row's FK never blocks
    // deleting a soon-to-be-gone parent. One table failing must not stop the rest.
    for (const table of [...RESTORE_TABLE_ORDER].reverse()) {
      const rows = file.tables[table] ?? [];
      const { data, error } = await supabase.rpc("fn_admin_restore_delete_orphans", { p_table_name: table, p_rows: rows });
      if (error) outcomes.push({ table: `${table} (delete pass)`, ok: false, error: error.message });
      else if ((data as number) > 0) outcomes.push({ table: `${table} (delete pass)`, ok: true, deleted: data as number });
    }
  }

  // Upserts always go parents-before-children so a child row's FK target already exists.
  for (const table of RESTORE_TABLE_ORDER) {
    const rows = file.tables[table] ?? [];
    if (!rows.length) continue;
    const { error } = await supabase.rpc("fn_admin_restore_upsert", { p_table_name: table, p_mode: mode, p_rows: rows });
    if (error) {
      outcomes.push({ table, ok: false, error: error.message });
    } else {
      outcomes.push({ table, ok: true, added_or_updated: rows.length });
    }
  }

  const anyFailed = outcomes.some((o) => !o.ok);
  return { error: anyFailed ? "Some tables could not be restored — see the report below." : null, outcomes };
}

// A single select("*") is silently capped by PostgREST's max-rows (1000 on
// Supabase by default), so the safety snapshot would quietly miss rows of
// any larger table. Same paging as backup/backup.js's fetchTable(): ordered
// by the primary key (paging without an order can repeat/skip rows), each
// page starting where the rows so far end, until an empty page arrives.
const SNAPSHOT_PAGE_SIZE = 1000;
const SNAPSHOT_PRIMARY_KEY: Record<string, string[]> = {
  provinces: ["code"],
  query_sources: ["code"],
  units: ["code"],
  role_permissions: ["permission_key"],
  unit_conversions: ["from_unit", "to_unit"],
  user_roles: ["user_id", "role_id"],
};

async function fetchAllRows(
  genericFrom: (table: string) => ReturnType<Awaited<ReturnType<typeof createClient>>["from"]>,
  table: string
): Promise<{ rows: unknown[]; error: string | null }> {
  const keyColumns = SNAPSHOT_PRIMARY_KEY[table] ?? ["id"];
  const rows: unknown[] = [];
  for (;;) {
    let query = genericFrom(table).select("*");
    for (const column of keyColumns) query = query.order(column);
    const { data, error } = await query.range(rows.length, rows.length + SNAPSHOT_PAGE_SIZE - 1);
    if (error) return { rows, error: error.message };
    const page = data ?? [];
    if (!page.length) return { rows, error: null };
    rows.push(...page);
  }
}

/** Full current-state export, in the exact same "hitech-restore" shape backup.js produces — used as the
 * automatic safety snapshot downloaded client-side right before a restore actually commits. */
export async function getSafetySnapshotAction(): Promise<ActionResult & { json?: string }> {
  const user = await getCurrentUser();
  if (!isOwner(user)) return NO_PERMISSION;

  const supabase = await createClient();
  // Generic dynamic-table access — deliberately outside Supabase's per-table generic
  // typing (that machinery isn't built for looping over every table name at once).
  const genericFrom = supabase.from.bind(supabase) as (table: string) => ReturnType<typeof supabase.from>;
  const tables: Record<string, unknown[]> = {};
  const missed: string[] = [];
  for (const table of RESTORE_TABLE_ORDER) {
    const { rows, error } = await fetchAllRows(genericFrom, table);
    if (error) {
      tables[table] = [];
      missed.push(table);
    } else {
      tables[table] = rows;
    }
  }
  const counts: Record<string, number> = {};
  for (const t of RESTORE_TABLE_ORDER) counts[t] = tables[t].length;

  const json = JSON.stringify(
    {
      format: "hitech-restore",
      version: 1,
      taken_at: new Date().toISOString(),
      note: "Automatic safety snapshot taken immediately before a Restore was committed.",
      order: RESTORE_TABLE_ORDER,
      missed,
      counts,
      tables,
    },
    null,
    2
  );
  return { error: null, json };
}

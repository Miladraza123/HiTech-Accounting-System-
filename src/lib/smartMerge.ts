// Shared client for Phase 18 Part B — Smart Merge.
//
// Replaces the old "reject the whole update if anything on the row
// changed" pattern with field-level 3-way conflict resolution: every
// field the user didn't touch is left alone no matter what changed on
// the server, and only a field that genuinely collided (same field,
// two different new values) is held back and reported for the user to
// resolve — every other field they changed is still applied.
//
// The actual 3-way diff runs inside Postgres (`fn_smart_merge_update`,
// see supabase/migrations/..._phase18_03_smart_merge.sql) so it's
// atomic with the write and can't race with a concurrent request; this
// module is just the typed client-side wrapper plus the pure `diffFields`
// helper every "edit an existing record" form uses to build its
// `base`/`changes` payloads.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SmartMergeConflict = {
  field: string;
  base_value: unknown;
  server_value: unknown;
  my_value: unknown;
};

export type SmartMergeResult = {
  applied: Record<string, unknown>;
  conflicts: SmartMergeConflict[];
};

/**
 * Given the record as this browser tab last loaded it (`base`) and the
 * values the user has now typed (`next`), returns only the fields that
 * actually changed — which is exactly what should be sent as
 * `p_changes` to `fn_smart_merge_update` (a field the user never
 * touched must never be able to conflict).
 */
export function diffFields(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    if (!valuesEqual(base[key], next[key])) {
      changes[key] = next[key];
    }
  }
  return changes;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined || b === "";
  if (b === null || b === undefined) return a === null || a === undefined || a === "";
  // Tolerate numeric-vs-string-vs-formatted-numeric mismatches ("18" vs 18 vs "18.00").
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

/**
 * Calls the generic Smart Merge RPC for one row of `table`. Only the
 * fields present in `base`/`changes` are ever considered — anything the
 * caller doesn't mention is left completely untouched.
 */
export async function smartMergeUpdate(
  supabase: SupabaseClient,
  table: string,
  rowId: string,
  base: Record<string, unknown>,
  changes: Record<string, unknown>
): Promise<{ result: SmartMergeResult | null; error: string | null }> {
  if (Object.keys(changes).length === 0) {
    return { result: { applied: {}, conflicts: [] }, error: null };
  }
  const { data, error } = await supabase.rpc("fn_smart_merge_update", {
    p_table_name: table,
    p_row_id: rowId,
    p_base: base,
    p_changes: changes,
  });
  if (error) return { result: null, error: error.message };
  return { result: data as SmartMergeResult, error: null };
}

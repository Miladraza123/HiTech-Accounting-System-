import type { SupabaseClient } from "@supabase/supabase-js";

// Shared list-page search: the term typed into a list's search box is cleaned
// once here, then turned into a PostgREST `.or()` filter over the list's own
// columns plus the ids of any parties / linked documents whose name matches.

const MAX_TERM = 80;

/**
 * Strips every character that is structural in a PostgREST filter value or a
 * LIKE pattern (commas, parens, %, _, \, *, quotes), so a pasted value can
 * neither break the `.or()` string nor act as a wildcard. Slashes and spaces
 * are kept — document numbers look like `HTE/TFPL/5001` and `SRB 012`.
 */
export function cleanSearchTerm(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/[,()%_\\*"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM);
}

/** `.or()` filter: each column ILIKE the term, plus `idCol IN (ids)` when given. */
export function searchOr(cols: string[], term: string, idMatches: { col: string; ids: string[] }[] = []): string {
  const parts = cols.map((c) => `${c}.ilike.%${term}%`);
  for (const m of idMatches) {
    if (m.ids.length) parts.push(`${m.col}.in.(${m.ids.join(",")})`);
  }
  return parts.join(",");
}

const ID_CAP = 300;

/** Ids of rows in `table` whose `col` contains the term (capped; for IN lookups). */
export async function idsMatching(supabase: SupabaseClient, table: string, col: string, term: string): Promise<string[]> {
  const { data } = await supabase.from(table).select("id").ilike(col, `%${term}%`).limit(ID_CAP);
  return (data ?? []).map((r: { id: string }) => r.id);
}

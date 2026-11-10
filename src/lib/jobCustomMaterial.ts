export type CustomMaterialRow = { key: string; name: string; qty: string; unit: string };

export type CustomMaterialLine = { name: string; required_qty: number; unit?: string };

/**
 * The custom material rows of the Job form as lines for the database. A row with no name is an empty row and is
 * skipped; a row with a name needs a quantity above zero.
 */
export function serializeCustomMaterials(rows: CustomMaterialRow[]): { lines: CustomMaterialLine[]; error: string | null } {
  const lines: CustomMaterialLine[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    const qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { lines: [], error: `Enter a quantity above zero for "${name}".` };
    lines.push({ name, required_qty: qty, ...(r.unit.trim() ? { unit: r.unit.trim() } : {}) });
  }
  return { lines, error: null };
}

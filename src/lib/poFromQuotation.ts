import type { LineType } from "@/lib/lineType";

/** The documents a PO will create, from the chosen lines: how many lines go into each. */
export function poPlan(lines: { include: boolean; line_type: LineType }[]): { material: number; fabrication: number; service: number } {
  const plan = { material: 0, fabrication: 0, service: 0 };
  for (const l of lines) if (l.include) plan[l.line_type] += 1;
  return plan;
}

/** Quotation line ids already turned into a Sales Order line or a Service Job line. */
export function convertedLineIds(
  soLines: { quotation_line_id: string | null }[],
  serviceJobs: { quoted_lines: unknown }[]
): Set<string> {
  const ids = new Set<string>();
  for (const l of soLines) if (l.quotation_line_id) ids.add(l.quotation_line_id);
  for (const j of serviceJobs) {
    if (!Array.isArray(j.quoted_lines)) continue;
    for (const q of j.quoted_lines as { quotation_line_id?: string | null }[]) if (q?.quotation_line_id) ids.add(q.quotation_line_id);
  }
  return ids;
}

/**
 * A line counts as already ordered when it, or any earlier-revision line it continues
 * (source_line_id, followed back through every revision), was turned into an order line.
 */
export function isLineOrdered(lineId: string, sourceOf: Map<string, string | null>, converted: Set<string>): boolean {
  const seen = new Set<string>();
  let cur: string | null | undefined = lineId;
  while (cur && !seen.has(cur)) {
    if (converted.has(cur)) return true;
    seen.add(cur);
    cur = sourceOf.get(cur);
  }
  return false;
}

/**
 * Project names already used on earlier Delivery Challans, newest first, each
 * name once (compared without regard to case or surrounding spaces). Feeds the
 * suggestion list of the challan's Project box; the box itself is free text.
 */
export function distinctProjects(rows: { project: string | null; created_at?: string | null }[]): string[] {
  const sorted = [...rows].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of sorted) {
    const name = (r.project ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

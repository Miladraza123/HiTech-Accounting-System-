/**
 * An invoice line may carry several HS codes in one text field — one per line, or separated by
 * commas, semicolons or spaces. Returns the individual codes, in order, without blanks or repeats.
 */
export function parseHsCodes(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    const code = part.trim();
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

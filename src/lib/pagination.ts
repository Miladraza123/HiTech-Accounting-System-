// Shared pagination helpers — every list page fetches a bounded page of
// rows via Supabase's `.range()` (never the whole table), and reuses the
// same page-size/page-number parsing and Prev/Next link-building so
// every list in the app paginates identically.
export const DEFAULT_PAGE_SIZE = 25;

export function parsePage(pageParam: string | undefined): number {
  const n = Number(pageParam);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** [from, to] inclusive bounds for `.range(from, to)`, 0-indexed. */
export function pageRange(page: number, pageSize: number = DEFAULT_PAGE_SIZE): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

export function totalPages(totalCount: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

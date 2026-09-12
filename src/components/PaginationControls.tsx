import Link from "next/link";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/**
 * Server-rendered "Showing X–Y of N records" summary + Prev/Next +
 * page-number links — preserves every other query param already on the
 * page (filters, etc.), only ever overriding `page`. Pass `totalCount`
 * to show the record-count summary even on a single page of results
 * (small datasets never reach page 2, but should still say how many
 * records exist); omit it to render only the page links, as before.
 */
export function PaginationControls({
  basePath,
  searchParams,
  currentPage,
  totalPages,
  totalCount,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  currentPage: number;
  totalPages: number;
  totalCount?: number;
  pageSize?: number;
}) {
  const showSummary = totalCount !== undefined;
  if (totalPages <= 1 && !showSummary) return null;

  function hrefFor(page: number) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && k !== "page") params.set(k, v);
    }
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  // Show first, last, current, and one on each side of current — collapse the rest with "…".
  const pages = new Set<number>([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const shown = Array.from(pages)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  const from = totalCount && totalCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const to = totalCount ? Math.min(currentPage * pageSize, totalCount) : 0;

  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {showSummary ? (
        <span className="font-mono text-xs text-ink-faint">
          {totalCount === 0 ? "0 records" : `Showing ${from}–${to} of ${totalCount} record${totalCount === 1 ? "" : "s"}`}
        </span>
      ) : (
        <span />
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-3">
          <Link
            href={hrefFor(Math.max(1, currentPage - 1))}
            aria-disabled={currentPage === 1}
            className={`rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink transition ${
              currentPage === 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-2"
            }`}
          >
            ← Peechay
          </Link>
          <div className="flex items-center gap-1 text-xs">
            {shown.map((p, i) => (
              <span key={p} className="flex items-center gap-1">
                {i > 0 && shown[i - 1] !== p - 1 && <span className="text-ink-faint px-1">…</span>}
                <Link
                  href={hrefFor(p)}
                  className={`rounded-md px-2.5 py-1.5 font-mono transition ${
                    p === currentPage ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-2"
                  }`}
                >
                  {p}
                </Link>
              </span>
            ))}
            <span className="text-ink-faint ml-1">/ {totalPages}</span>
          </div>
          <Link
            href={hrefFor(Math.min(totalPages, currentPage + 1))}
            aria-disabled={currentPage === totalPages}
            className={`rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink transition ${
              currentPage === totalPages ? "pointer-events-none opacity-40" : "hover:bg-surface-2"
            }`}
          >
            Agay →
          </Link>
        </div>
      )}
    </div>
  );
}

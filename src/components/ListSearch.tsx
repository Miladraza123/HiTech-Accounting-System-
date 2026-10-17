import Link from "next/link";
import { Search } from "lucide-react";

/**
 * Plain server-rendered GET form (works without client JS): the typed term goes
 * into `?q=`, every other filter already on the page is carried as a hidden
 * field, and `page` is dropped so a new search starts on page 1.
 */
export function ListSearch({
  basePath,
  q,
  keep,
  placeholder,
  count,
}: {
  basePath: string;
  q: string;
  keep: Record<string, string | undefined>;
  placeholder: string;
  /** Total matches; shown beside the box while a search is active. */
  count?: number | null;
}) {
  const kept = Object.entries(keep).filter(([k, v]) => v !== undefined && k !== "q" && k !== "page") as [string, string][];
  const clearParams = new URLSearchParams(kept);
  const clearHref = clearParams.toString() ? `${basePath}?${clearParams.toString()}` : basePath;
  return (
    <form action={basePath} method="get" role="search" className="flex flex-wrap items-center gap-2">
      {kept.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="relative w-full sm:w-80">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label="Search this list"
          className="w-full rounded-md border border-line-strong bg-bg py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <button type="submit" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs font-medium text-ink hover:bg-surface-2 transition">
        Search
      </button>
      {q && count != null && (
        <span className="font-mono text-xs text-ink-faint">
          {count === 0 ? `No match for "${q}"` : `${count} match${count === 1 ? "" : "es"} for "${q}"`}
        </span>
      )}
      {q && (
        <Link href={clearHref} className="text-xs text-accent-ink underline underline-offset-2">
          Clear search
        </Link>
      )}
    </form>
  );
}

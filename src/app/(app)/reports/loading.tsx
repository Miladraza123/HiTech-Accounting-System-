import { KpiGridSkeleton, Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

// This wraps every route under /reports/* in a <Suspense> boundary (App
// Router's loading.tsx convention cascades to nested segments that don't
// define their own), so it stays generic enough to look reasonable on the
// KPI-heavy Owner Dashboard AND the ~25 simpler single-table sub-reports —
// a title bar, an optional KPI-shaped row, and a couple of content blocks.
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-surface-2 p-4">
        <Skeleton className="h-4 w-48" />
      </div>
      <KpiGridSkeleton count={4} />
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
}

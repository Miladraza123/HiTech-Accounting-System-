import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
      <p className="text-4xl font-semibold text-ink-faint font-mono">404</p>
      <h1 className="text-lg font-semibold text-ink">This record was not found</h1>
      <p className="text-sm text-ink-soft max-w-sm">
        Either it has been deleted, the link is incorrect, or you don&apos;t have access to it.
      </p>
      <Link href="/" className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
        Back to Home
      </Link>
    </div>
  );
}

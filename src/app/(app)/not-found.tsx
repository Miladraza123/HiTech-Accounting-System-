import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
      <p className="text-4xl font-semibold text-ink-faint font-mono">404</p>
      <h1 className="text-lg font-semibold text-ink">Yeh record nahi mila</h1>
      <p className="text-sm text-ink-soft max-w-sm">
        Ya to yeh delete ho chuka hai, ya link ghalat hai, ya aapko is tak access nahi hai.
      </p>
      <Link href="/" className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
        Home par wapis jayen
      </Link>
    </div>
  );
}

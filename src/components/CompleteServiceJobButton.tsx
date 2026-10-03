"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeServiceJobAction } from "@/app/actions/serviceJobs";

export function CompleteServiceJobButton({ serviceJobId }: { serviceJobId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await completeServiceJobAction(serviceJobId);
          router.refresh();
        })
      }
      className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
    >
      {pending ? "…" : "Mark Completed (ready for delivery)"}
    </button>
  );
}

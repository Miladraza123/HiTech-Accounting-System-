"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Mounted (invisibly) on the Incoming Documents list page. Without this, a
 * new email arriving via the inbound webhook only showed up after a manual
 * refresh — the page is a plain Server Component fetch with no live
 * subscription. Mirrors NotificationBell.tsx's exact Realtime pattern.
 */
export function IncomingDocumentsLive() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("incoming_documents:list")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "incoming_documents" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}

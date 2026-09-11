"use client";

import { useRef, useState, useTransition } from "react";
import {
  uploadAttachmentAction,
  getAttachmentUrlAction,
  deleteAttachmentAction,
} from "@/app/actions/attachments";
import type { Tables } from "@/lib/supabase/database.types";

export function AttachmentsPanel({
  ownerTable,
  ownerId,
  revalidateTo,
  attachments,
  canManage,
}: {
  ownerTable: string;
  ownerId: string;
  revalidateTo: string;
  attachments: Tables<"attachments">[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await uploadAttachmentAction(ownerTable, ownerId, revalidateTo, formData);
      if (res.error) setError(res.error);
      else formRef.current?.reset();
    });
  }

  async function handleOpen(path: string, id: string) {
    setOpeningId(id);
    const url = await getAttachmentUrlAction(path);
    setOpeningId(null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" required className="text-xs" />
          <input name="label" placeholder="Label (optional)" className="input !w-40 text-xs" />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition disabled:opacity-50"
          >
            {pending ? "Upload ho raha…" : "Upload"}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}

      <ul className="space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
            <button
              type="button"
              onClick={() => handleOpen(a.file_path, a.id)}
              disabled={openingId === a.id}
              className="text-accent-ink underline underline-offset-2 truncate disabled:opacity-50"
            >
              {openingId === a.id ? "…" : a.label || a.file_path.split("/").pop()}
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => startTransition(() => deleteAttachmentAction(a.id, a.file_path, revalidateTo))}
                className="text-xs text-bad shrink-0"
              >
                Hatayen
              </button>
            )}
          </li>
        ))}
        {!attachments.length && <li className="text-xs text-ink-faint">Koi attachment nahi.</li>}
      </ul>
    </div>
  );
}

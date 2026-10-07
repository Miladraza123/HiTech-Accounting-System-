"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePolicyGroupAction } from "@/app/actions/hr";

export function PolicyGroupEditForm({
  group,
}: {
  group: { id: string; name: string; description: string | null; is_active: boolean };
}) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [isActive, setIsActive] = useState(group.is_active);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updatePolicyGroupAction({ id: group.id, name, description, is_active: isActive });
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Group name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-ink pb-2">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {saved && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Saved.</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md border border-line-strong bg-bg px-4 py-1.5 text-sm hover:bg-surface-2 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save Name / Status"}
      </button>
    </div>
  );
}

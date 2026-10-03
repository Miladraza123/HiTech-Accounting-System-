"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createServiceDeliveryAction } from "@/app/actions/serviceJobs";

export function NewServiceDeliveryForm({ serviceJobId }: { serviceJobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
        + Create Service Delivery (return item to client)
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createServiceDeliveryAction({
        service_job_id: serviceJobId,
        delivery_date: deliveryDate || null,
        vehicle_no: vehicleNo || null,
        driver_name: driverName || null,
        remarks: remarks || null,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-line bg-bg p-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-ink-faint">Date</span>
          <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="input !py-1 text-xs" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-faint">Vehicle #</span>
          <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className="input !py-1 text-xs" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-faint">Driver</span>
          <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className="input !py-1 text-xs" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-ink-faint">Remarks</span>
        <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input !py-1 text-xs" />
      </label>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-xs">
          Back
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Confirm Delivery"}
        </button>
      </div>
    </div>
  );
}

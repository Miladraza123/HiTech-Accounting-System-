"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVehicleAction } from "@/app/actions/vehicles";
import type { Tables } from "@/lib/supabase/database.types";

export function NewVehicleForm({ profiles }: { profiles: Tables<"profiles">[] }) {
  const router = useRouter();
  const [vehicleNo, setVehicleNo] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [makeModel, setMakeModel] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [assignmentDate, setAssignmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [openingMeter, setOpeningMeter] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!vehicleNo.trim()) {
      setError("Vehicle number zaroori hai.");
      return;
    }
    startTransition(async () => {
      const res = await createVehicleAction({
        vehicle_no: vehicleNo.trim(),
        registration_no: registrationNo.trim() || null,
        vehicle_type: vehicleType.trim() || null,
        make_model: makeModel.trim() || null,
        assigned_user_id: assignedUserId || null,
        assignment_date: assignedUserId ? assignmentDate : null,
        opening_meter_reading: Number(openingMeter) || 0,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setVehicleNo("");
      setRegistrationNo("");
      setVehicleType("");
      setMakeModel("");
      setAssignedUserId("");
      setOpeningMeter("0");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Vehicle Number *</span>
          <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className="input" placeholder="e.g. LEA-1234" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Registration Number</span>
          <input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} className="input" />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Vehicle Type</span>
          <input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="input" placeholder="e.g. Car / Bike / Van" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Make / Model</span>
          <input value={makeModel} onChange={(e) => setMakeModel(e.target.value)} className="input" placeholder="e.g. Honda CD-70" />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Assigned Engineer/Rider</span>
          <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className="input">
            <option value="">— Unassigned —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        {assignedUserId && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Assignment Date</span>
            <input type="date" value={assignmentDate} onChange={(e) => setAssignmentDate(e.target.value)} className="input" />
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Opening Meter Reading</span>
          <input type="number" step="0.01" min="0" value={openingMeter} onChange={(e) => setOpeningMeter(e.target.value)} className="input" />
        </label>
      </div>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Vehicle Banayen"}
      </button>
    </div>
  );
}

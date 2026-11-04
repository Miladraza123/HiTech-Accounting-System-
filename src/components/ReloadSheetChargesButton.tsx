"use client";

import { reloadLineChargesAction } from "@/app/actions/hr";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";

/** Draft sheet: replace the fixed charges of every line with the currently set ones. */
export function ReloadSheetChargesButton({ sheetId }: { sheetId: string }) {
  return (
    <ConfirmActionButton
      label="Load fixed charges for all employees"
      confirmText="Replace every line's fixed charges with the set ones (edits made on this sheet are lost)?"
      action={() => reloadLineChargesAction(sheetId, null)}
    />
  );
}

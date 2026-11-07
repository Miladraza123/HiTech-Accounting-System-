/** What kind of work a quotation line is; decides which document a client PO turns it into. */
export type LineType = "material" | "fabrication" | "service";

export const LINE_TYPE_LABELS: Record<LineType, string> = { material: "Material", fabrication: "Fabrication", service: "Service" };

/** Lines saved before types existed have none: they read as material. */
export function asLineType(v: string | null | undefined): LineType {
  return v === "fabrication" || v === "service" ? v : "material";
}

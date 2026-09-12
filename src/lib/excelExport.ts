import ExcelJS from "exceljs";

export type ExcelColumn = { header: string; key: string; width?: number };

/**
 * Builds a single-sheet .xlsx workbook and returns it as a downloadable
 * Response — the shared mechanism behind every report's "Export to Excel"
 * link (prompt §58). Route handlers call this with their own already-
 * computed rows; no query logic lives here.
 */
export async function buildExcelResponse(sheetName: string, columns: ExcelColumn[], rows: Record<string, unknown>[], filename: string): Promise<Response> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

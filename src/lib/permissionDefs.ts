// Pure, client-safe constants split out of lib/permissions.ts (which
// imports next/headers via the server Supabase client and therefore
// can't be imported from Client Components) — same split roles.ts
// already does for auth.ts.

export type PermissionKey =
  | "query.manage"
  | "quotation.manage"
  | "sales_order.manage"
  | "purchase_order.manage"
  | "delivery_challan.manage"
  | "delivery_challan.dispute"
  | "job.manage"
  | "job.material.manage"
  | "product_template.manage"
  | "invoice.manage"
  | "supplier_bill.manage"
  | "payment.manage"
  | "expense.manage"
  | "fund_transfer.manage"
  | "journal_voucher.manage"
  | "sales_return.manage"
  | "purchase_return.manage"
  | "inventory_adjustment.request"
  | "stock_transfer.create";

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  module: string;
  /** The database floor — roles beyond this list will be rejected by the underlying SQL function no matter what the matrix says. Shown in the UI so Owner never grants something that silently won't work. */
  dbAllowedRoles: string[];
};

export const PERMISSION_DEFS: PermissionDef[] = [
  { key: "query.manage", label: "Create/edit Query", module: "Sales & CRM", dbAllowedRoles: ["sales"] },
  { key: "quotation.manage", label: "Create/revise/send Quotation", module: "Sales & CRM", dbAllowedRoles: ["sales"] },
  { key: "sales_order.manage", label: "Create/amend/cancel Sales Order", module: "Sales & CRM", dbAllowedRoles: ["sales"] },
  { key: "purchase_order.manage", label: "Create/cancel Purchase Order + GRN receiving", module: "Purchase & Store", dbAllowedRoles: ["store"] },
  { key: "inventory_adjustment.request", label: "Request Stock Adjustment", module: "Purchase & Store", dbAllowedRoles: ["store"] },
  { key: "stock_transfer.create", label: "Stock Transfer (warehouse-to-warehouse)", module: "Purchase & Store", dbAllowedRoles: ["store"] },
  { key: "job.manage", label: "Create/progress/cancel Job", module: "Fabrication", dbAllowedRoles: ["production"] },
  { key: "job.material.manage", label: "Reserve/issue/return Job material", module: "Fabrication", dbAllowedRoles: ["production", "store"] },
  { key: "product_template.manage", label: "Create BOM/Product Template", module: "Fabrication", dbAllowedRoles: ["production"] },
  { key: "delivery_challan.manage", label: "Create/cancel/POD Delivery Challan", module: "Dispatch", dbAllowedRoles: ["dispatch"] },
  { key: "delivery_challan.dispute", label: "Record Delivery dispute", module: "Dispatch", dbAllowedRoles: ["dispatch", "sales"] },
  { key: "invoice.manage", label: "Create/cancel GST Invoice", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "supplier_bill.manage", label: "Create/cancel Supplier Bill", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "payment.manage", label: "Record/cancel/allocate Payment", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "expense.manage", label: "Record/cancel Expense", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "fund_transfer.manage", label: "Transfer Cash/Bank/Petty-Cash", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "journal_voucher.manage", label: "Create Manual Journal Voucher", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "sales_return.manage", label: "Create/cancel Sales Return (credit note)", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "purchase_return.manage", label: "Create/cancel Purchase Return (debit note)", module: "Accounts & Finance", dbAllowedRoles: ["accounts", "store"] },
];

export const PERMISSION_MODULES = [...new Set(PERMISSION_DEFS.map((p) => p.module))];

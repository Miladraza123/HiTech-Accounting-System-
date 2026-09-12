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
  { key: "query.manage", label: "Query create/edit karna", module: "Sales & CRM", dbAllowedRoles: ["sales"] },
  { key: "quotation.manage", label: "Quotation create/revise/send karna", module: "Sales & CRM", dbAllowedRoles: ["sales"] },
  { key: "sales_order.manage", label: "Sales Order create/amend/cancel karna", module: "Sales & CRM", dbAllowedRoles: ["sales"] },
  { key: "purchase_order.manage", label: "Purchase Order create/cancel + GRN receiving", module: "Purchase & Store", dbAllowedRoles: ["store"] },
  { key: "inventory_adjustment.request", label: "Stock Adjustment request karna", module: "Purchase & Store", dbAllowedRoles: ["store"] },
  { key: "stock_transfer.create", label: "Stock Transfer (warehouse-to-warehouse)", module: "Purchase & Store", dbAllowedRoles: ["store"] },
  { key: "job.manage", label: "Job create/progress/cancel karna", module: "Fabrication", dbAllowedRoles: ["production"] },
  { key: "job.material.manage", label: "Job material reserve/issue/return karna", module: "Fabrication", dbAllowedRoles: ["production", "store"] },
  { key: "product_template.manage", label: "BOM/Product Template create karna", module: "Fabrication", dbAllowedRoles: ["production"] },
  { key: "delivery_challan.manage", label: "Delivery Challan create/cancel/POD karna", module: "Dispatch", dbAllowedRoles: ["dispatch"] },
  { key: "delivery_challan.dispute", label: "Delivery dispute record karna", module: "Dispatch", dbAllowedRoles: ["dispatch", "sales"] },
  { key: "invoice.manage", label: "GST Invoice create/cancel karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "supplier_bill.manage", label: "Supplier Bill create/cancel karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "payment.manage", label: "Payment record/cancel/allocate karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "expense.manage", label: "Expense record/cancel karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "fund_transfer.manage", label: "Cash/Bank/Petty-Cash transfer karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "journal_voucher.manage", label: "Manual Journal Voucher create karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "sales_return.manage", label: "Sales Return (credit note) create/cancel karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts"] },
  { key: "purchase_return.manage", label: "Purchase Return (debit note) create/cancel karna", module: "Accounts & Finance", dbAllowedRoles: ["accounts", "store"] },
];

export const PERMISSION_MODULES = [...new Set(PERMISSION_DEFS.map((p) => p.module))];

# HiTech Business Management & Accounting System

A unified Material Supply + Fabrication business platform — one client
ledger, one inventory, one chart of accounts, one Owner Dashboard.
Built for a Pakistan-based business (FBR Sales Tax / GST, NTN, STRN).

See the full architecture, database design, accounting engine and
implementation phases in the design blueprint shared with the project
owner. This repository implements it phase by phase.

## Status: Phase 5 — Delivery, Invoicing & Payments (complete)

Goods leave the warehouse, get billed with Pakistan's FBR GST, and get
paid — bill-wise, in both directions (customer receipts and supplier
payments) — closing the loop this system's blueprint laid out.

- **Delivery Challan** — partial delivery against a Sales Order line is
  fully supported (delivered qty can never exceed ordered qty — a hard
  physical block, not a soft warning). Each line can optionally **issue
  from warehouse stock** — left unchecked for goods whose cost was
  already recognised earlier (a `direct`-PO Material Supply line, or a
  Fabrication job's finished output, which was never itemized into
  `stock_ledger` in the first place); checked, it posts Dr COGS
  (business-line-specific: 5000 Material / 5010 Fabrication) / Cr Raw
  Material Inventory (1310) at current weighted-average cost. A Job
  whose Sales Order line becomes fully delivered auto-advances from
  `ReadyForDispatch` to `Delivered`.
- **Client Acceptance / POD** — Accept (name + optional note) or
  Dispute (reason required), tracked separately from the DC's own
  Issued/Cancelled status.
- **GST Invoice & Billing** — a single Pakistan FBR Sales Tax rate per
  line (no CGST/SGST/IGST split), invoiced strictly against **delivered**
  qty (never ordered) — "bill what's been delivered". Posts Dr Trade
  Receivables (1200) / Cr Sales Revenue (business-line-specific: 4000 /
  4010) + Cr Output Sales Tax Payable (2400).
- **Supplier Bill booking** (deferred from Phase 3) — clears GRN
  Clearing (1330) into Trade Payables (2100) for `stock`-type GRNs only;
  `direct`/`general` GRNs already booked Trade Payables straight at
  receiving time and are refused here to prevent double-booking. Books
  **all** lines of one GRN at once, at exactly the GRN's own rate/tax
  (no override) so 1330 always nets to zero — and this is also where
  reclaimable Input Sales Tax (1400) is recognised for the first time,
  since GRN receiving happens before the supplier's actual tax invoice
  exists.
- **Bill-wise Payment & Recovery** — one `payments` table, both
  directions: a customer **receipt** allocated against one or more
  Invoices, or a supplier **payment** allocated against one or more
  Supplier Bills. Allocation can be partial — the remainder sits as an
  on-account advance (`unallocated_amount`) and can be applied later.
  Posts Dr Bank/Cash (1100) / Cr Trade Receivables on a receipt, or
  Dr Trade Payables / Cr Bank/Cash on a payment.
- Cancelling anything in this phase is deliberately conservative: a DC
  can't be cancelled once its Sales Order has an invoice; an Invoice or
  Supplier Bill can't be cancelled once a payment has been allocated
  against it — reverse the payment first. Every cancel reverses its own
  journal entry.

**Scope note:** Client Credit Control (credit-limit warnings at invoice
time, aging, dashboards) is intentionally **not** in this phase — the
`credit_limit`/`credit_days` columns have existed on `parties` since
Phase 0 for exactly this, and it ships with Phase 6 (Customer 360 &
Reports) alongside the Daily Ledger/Day Book, where it belongs next to
the rest of the reporting suite rather than half-built here.

<details>
<summary>Phase 4 — Fabrication & Jobs (complete)</summary>

Jobs (Work Orders) turn a Fabrication Sales Order line into a tracked
production job — material requirement, reservation, issue, costing and
a status workflow, all in one place.

- **BOM / Product Templates** — a reusable "recipe" (raw material +
  qty-per-output-unit) for repeat products. Creating a Job with a
  template auto-computes `required_qty = qty_per_unit × job_qty`; a
  Job can just as easily skip the template and take fully custom
  material lines instead — both are first-class, per the "kuch custom,
  kuch repeat" requirement.
- **Material Reservation & Shortage** (blueprint §8) — `stock_availability`
  (Available / Reserved / Free) drives both flows: creating a Job
  **auto-reserves** whatever free stock exists for each requirement,
  and Owner/Production/Store can additionally **manually reserve** to
  prioritise an urgent job. Any gap between required and reserved shows
  as a **"Purchase Required"** shortage badge on the Job — a signal,
  never a block. Inventory's own list page also shows Reserved/Free
  columns, not just On Hand.
- **Job status workflow** — `MaterialPending → MaterialAvailable →
  FabricationStarted → InProcess → ReadyForDispatch → Delivered /
  Cancelled`. All of it is automated where the blueprint calls for it:
  reserving enough stock flips Material Pending → Available; the
  **first material issue** on an Available job flips it to Fabrication
  Started; raising progress above 0% flips Fabrication Started →
  In Process (one-way — never reverts on a later progress edit).
  Cancelling is blocked once material has been issued and not
  returned, and always requires a reason.
- **Issue / Return** — issuing consumes Active reservations oldest
  first (partial consumption supported), moves real stock at the
  item's current weighted-average cost, and posts Dr Work-in-Progress
  (1320) / Cr Raw Material Inventory (1310); returning reverses both
  the stock movement and the journal entry.
- **Job Cost Ledger** — every material issue/return is a costed line;
  the Job detail page totals Material / Labour / Overhead.

**Scope note:** Job costing here is **material only** — Labour and
Overhead cost types exist in the schema (`job_cost_ledger.cost_type`)
and are shown in the cost summary, but nothing posts to them yet since
there's no payroll/expense-allocation system in this build to source
those numbers from. This is a deliberate, called-out deferral, not a
gap in the material-costing flow itself.

</details>

<details>
<summary>Phase 3 — Purchase, GRN & Inventory (complete)</summary>

The Item Master (raw material / stocked goods / fabrication products,
with unit, HS Code, tax category) is now in place — everything from
Quotations onward can reference a real item, not just free text.

- **Purchase Orders** — three types matching §5's categories: `direct`
  (against a specific client Sales Order, never touches stock — bypass
  path for Material Supply), `stock` (into a warehouse), `general`
  (misc expense, no inventory link).
- **GRN (receiving)** — partial receiving is fully supported; stock
  always moves by the **actual received qty**, never the ordered qty.
  Every line shows ordered vs. previously-received vs. this-receipt vs.
  short/excess (`short_excess_qty`, a generated column — negative is
  short, positive is excess), exactly as specified.
- **Stock ledger** — append-only, single source of truth for current
  stock; a database function (`_fn_post_stock_ledger`) serializes
  concurrent postings per item+warehouse with an advisory lock,
  maintains a running balance and a weighted-average cost, and refuses
  to let stock go negative.
- **Stock adjustments require Owner approval** — Store can only
  *request* one; approving is what actually moves stock and posts the
  accounting entry (shortage = expense, excess = income), at the item's
  current average cost.
- **Accounting**: GRN on a `stock` line posts Dr Raw Material Inventory
  / Cr GRN Clearing; `direct`/`general` receipts post straight to
  Dr COGS-or-Expense (+ Input Tax) / Cr Trade Payables, per the
  blueprint.

**Scope note:** two things originally planned for this phase moved
elsewhere for a good reason — **Material Reservation** (blueprint §8)
is meaningless without a Job to reserve *for*, so it shipped with
Phase 4 (Fabrication) instead. **Supplier Bill booking** (the step
that clears GRN Clearing into Trade Payables) is deferred to Phase 5,
alongside GST Invoice/Payment, for symmetry with the Accounts
Receivable side.

</details>

<details>
<summary>Phase 2 — Client PO / Sales Order (complete)</summary>

A Sales Order is created straight from a Quotation (lines pre-filled,
editable), capturing the Client PO Number, PO date, delivery schedule,
business line (Material Supply vs. Fabrication — this is what later
powers the split Owner Dashboard), and payment terms. Creating it
auto-advances the Quotation to `Accepted` and the Query to `Won`.

- **Duplicate PO detection** — same client + same PO number surfaces as
  a **warning** the user can proceed past (never a hard block); a
  different client using the same PO number is fine and never flagged.
- **Amendments, not overwrites** — every change to a confirmed order
  snapshots the prior header+lines into `sales_order_revisions` first,
  requires a reason, and a line that already has deliveries against it
  (`delivered_qty > 0`) cannot be removed.
- Per-line `ordered_qty` / `delivered_qty` / `invoiced_qty` columns are
  already in place (stable line ids) for Phases 3–5 (GRN, Delivery
  Challan, Invoice) to update as those modules land.

</details>

<details>
<summary>Phase 1 — Query & Quotation (complete)</summary>

Clients & Suppliers (party master UI), Query capture with an activity/
follow-up timeline and manual status transitions (On Hold / Lost /
Reopen), and a full Quotation builder: create from a Query, line items
against the item master or free-text, automatic tax totals, Draft →
Sent workflow, versioned revisions (Rev-0, Rev-1, …) that are never
overwritten, and a print/PDF view. Creating a Quotation automatically
advances its Query from `Open` to `Quoted`.

</details>

<details>
<summary>Phase 0 — Foundation (complete)</summary>

What's live in this phase:

- **Auth & roles** — Supabase Auth (email/password), 7 fixed roles
  (Owner, Sales/CRM, Store/Purchase, Production, Accounts, Dispatch,
  Auditor), enforced with Postgres Row Level Security — not just hidden
  in the UI.
- **Company & warehouse setup** — one company profile, multiple
  warehouses/branches.
- **Chart of Accounts** — starter double-entry ledger with a
  `fn_post_journal_entry` posting engine (balanced entries enforced by a
  database constraint, never hand-editable).
- **Numbering engine** — atomic, fiscal-year-aware document numbering
  (`fn_get_next_number`) for every document type used in later phases.
- **Audit trail** — every INSERT/UPDATE/DELETE on the core tables is
  logged field-by-field (`audit_log`), plus a full login/logout session
  trail (`login_sessions`) separate from data-change history.
- **Import Wizard** — CSV/Excel upload for existing Clients, Suppliers,
  and Opening Receivables/Payables, with a preview step and a
  per-import batch record (`import_batches`). Opening Stock import
  arrives with the Inventory module (Phase 3).

Phases 6–7 (Customer 360 & Reports, Hardening) are not built yet.

</details>

## Stack

- **Database**: PostgreSQL (Supabase) — schema, RLS policies, triggers
  and posting functions all live in the database, not just the app.
- **App**: Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind CSS 4.
- **Auth/Storage**: Supabase Auth + Storage (private buckets for
  attachments and import files).

## Running locally

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project URL + publishable key
npm run dev
```

The **first person to sign up** (`/signup`) is prompted to claim Owner
access (`/bootstrap`) — after that, the Owner assigns roles to everyone
else from **Users & Roles**.

## Project layout

```
src/
  app/
    login/, signup/            — auth pages
    quotations/[id]/print/     — standalone print/PDF view (no sidebar chrome)
    (app)/                     — authenticated shell (sidebar, role-aware nav)
      bootstrap/               — first-run "claim Owner" screen
      clients/                 — client/supplier (party) management
      queries/                 — Query list, create, detail + activity timeline
      quotations/              — Quotation list, create (from a Query), detail
      sales-orders/            — Sales Order list, create (from a Quotation), detail + amendments
      items/                   — Item Master (raw material / stocked goods / products)
      purchase-orders/         — Purchase Order list, create, detail + GRN receiving
      inventory/               — Current stock (+ Reserved/Free), per-item ledger drill-down,
                                  stock adjustments
      jobs/                    — Job list, create (from a Fabrication SO line), detail —
                                  material requirements, reserve/issue/return, progress,
                                  ready-for-dispatch, cancel, cost summary
      product-templates/       — BOM/Product Template list, create, detail
      delivery-challans/       — DC list, create (from a Sales Order), detail —
                                  Client Acceptance/POD, dispute, cancel
      invoices/                — GST Invoice list, create (against delivered qty), detail —
                                  payment history, cancel
      supplier-bills/          — Supplier Bill list, create (from a 'stock'-type GRN), detail —
                                  payment history, cancel
      payments/                — Payment list, create (receipt or payment, bill-wise
                                  allocation), detail — allocate remainder, cancel
      setup/company/           — company profile
      setup/warehouses/        — warehouse management
      setup/users/             — role assignment
      setup/chart-of-accounts/ — ledger accounts
      setup/import/            — CSV/Excel Import Wizard
    actions/                   — Server Actions (auth, setup, import, queries, quotations,
                                  salesOrders, purchaseOrders, items, inventory, jobs,
                                  deliveryChallans, invoices, supplierBills, payments,
                                  parties, attachments)
  components/                  — client-side form/UI components
  lib/
    supabase/                  — browser + server Supabase clients, generated DB types
    auth.ts, roles.ts          — current-user/role helpers
  proxy.ts                     — session refresh + route protection (Next.js 16's
                                  renamed middleware.ts)
```

Database migrations for this phase live in `supabase/migrations/` (applied
against the Supabase project via the Supabase CLI or MCP tooling — this
repo does not bundle the CLI itself). `src/lib/supabase/database.types.ts`
is generated from the live database schema.

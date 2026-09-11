# HiTech Business Management & Accounting System

A unified Material Supply + Fabrication business platform — one client
ledger, one inventory, one chart of accounts, one Owner Dashboard.
Built for a Pakistan-based business (FBR Sales Tax / GST, NTN, STRN).

See the full architecture, database design, accounting engine and
implementation phases in the design blueprint shared with the project
owner. This repository implements it phase by phase.

## Status: Phase 2 — Client PO / Sales Order (complete)

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

Phases 3–7 (Purchase/GRN/Inventory, Fabrication/Jobs,
Delivery/Invoicing/Payments, Customer 360 & Reports, Hardening) are not
built yet.

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
      setup/company/           — company profile
      setup/warehouses/        — warehouse management
      setup/users/             — role assignment
      setup/chart-of-accounts/ — ledger accounts
      setup/import/            — CSV/Excel Import Wizard
    actions/                   — Server Actions (auth, setup, import, queries, quotations, salesOrders, parties, attachments)
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

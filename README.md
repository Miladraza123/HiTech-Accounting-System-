# HiTech Business Management & Accounting System

A unified Material Supply + Fabrication business platform — one client
ledger, one inventory, one chart of accounts, one Owner Dashboard.
Built for a Pakistan-based business (FBR Sales Tax / GST, NTN, STRN).

See the full architecture, database design, accounting engine and
implementation phases in the design blueprint shared with the project
owner. This repository implements it phase by phase.

## Status: Phase 19 — UI Polish & Visual Design System (complete)

A pure presentation-layer pass across the whole app — no schema changes,
no new tables/columns, no changed business logic, RPC signatures, or
permission rules; every `show`/role-gating expression on every nav item
was carried over completely unchanged. Ten pieces, each scoped and
approved via an image-preview mockup (published as a design canvas)
before any real code was touched:

**1 — Design system foundation.** `src/components/ui/{Button,Badge,Card,
EmptyState,Skeleton}.tsx` — a shared `buttonClass(variant, size)` helper
(primary/secondary/danger/ghost), a `<Badge tone dot>` pill (warn/good/
bad/neutral/ledger/accent tones), `<Card>`/`<CardHeader>`, `<EmptyState
icon title description action>`, and skeleton placeholders
(`<Skeleton>`, `<TableSkeleton>`, `<KpiGridSkeleton>`). `Logo.tsx` — a
fixed-color warehouse-mark SVG replacing the plain "H" square everywhere.
`globals.css` gained a `:root[data-theme="dark"]` block, an `.input-error`
state, and a global `:focus-visible` outline for keyboard navigation.

**2 — English action labels.** Every "+ Naya/Nayi X" create-button across
17 files (Queries, Quotations, Sales Orders, Purchase Orders, Jobs,
Invoices, Supplier Bills, Payments, Expenses, Delivery Challans, Journal
Vouchers, Stock Transfers, Product Templates, Vehicles, revisions, …)
translated to "+ New X" and moved onto the shared `buttonClass()`.

**3 — Data table polish.** The 10 paginated list pages now show a shared
"Showing X–Y of N records" summary (`PaginationControls` rewritten to
accept `totalCount`/`pageSize`), zebra-striped rows (`even:bg-bg`), status
pills converted to `<Badge tone=...>`, and a proper `<EmptyState>` (with
its own "+ New X" action) in place of a bare "No records" line when a
filtered list comes back empty.

**4 — New Client/Supplier form.** `PartyForm.tsx` reorganized into
labeled sections (Basic Info / Tax & Registration / Credit Terms) with a
consistent `Field` label helper and a red-asterisk required indicator.
(`ItemForm.tsx` was left as-is — out of the approved mockup set.)

**5 — Loading skeletons.** A `loading.tsx` added to each of the 10
paginated list routes plus `/reports` (deliberately generic, since
Next.js 16 cascades a parent segment's `loading.tsx` to every nested
child route that doesn't define its own — `/reports/ar-aging` and the
~25 other sub-reports all inherit it).

**6 — Print letterhead.** A faint full-page SVG watermark and a logo +
company-name header block added to all 5 print templates (Quotation,
Invoice, Delivery Challan, Purchase Order, Supplier Bill), with a bolder
accent-colored header rule.

**7 — Dark mode toggle.** A 3-way Light/Dark/Auto segmented control
(`ThemeToggle.tsx`) in the sidebar and mobile nav footer, backed by
`localStorage` + a `data-theme` attribute on `<html>`. An inline
anti-flash script in the root `<head>` applies the stored choice
synchronously before first paint, so there's never a light-mode flash on
a dark-mode reload.

**8 — Sidebar reorder & categorization.** The flat 34-item nav list
regrouped into 8 labeled categories (Contacts, Sales & Billing,
Purchases, Inventory/Stock, Fabrication/Jobs, Accounts & Finance,
Settings/Administration, …) matching how the business actually thinks
about its own workflow, each item given a `lucide-react` icon
(`SidebarNav.tsx`, shared between desktop `<aside>` and `MobileNav`).
Every item's original `show` visibility rule is untouched — this was a
purely presentational regrouping.

**9 — Owner Dashboard visual redesign.** A time-of-day greeting banner
(Karachi-timezone-aware — "Good morning/afternoon/evening, {name}") on a
fixed-navy gradient background; every KPI card now carries an icon chip;
the "Action Required" list and five recent-activity sections (Queries,
Quotations, Fabrication Jobs, Pending Deliveries, Payment Follow-ups)
converted to `<Badge>` status pills with zebra-striped rows. All existing
filters, date ranges, and KPI calculations are unchanged — this was
visual-only.

**10 — App-wide footer.** A footer below the sidebar+main layout on every
authenticated page: `Powered by "OHT Solutions"` and a `v1.0.0` version
tag.

Verified after every task and again across the full cumulative diff:
`npx tsc --noEmit`, `npx eslint .`, `npm test` (38 tests, all passing),
and `npm run build` (full production build) all clean.

<details>
<summary>Phase 18 — Performance & Smart Merge (complete)</summary>

Four independent pieces, built in dependency order (Indexes → Pagination →
Smart Merge → PWA/Offline, since the offline queue has to replay through
Smart Merge's conflict-aware save path):

**A.1 — Missing-index audit.** Every single-column foreign key in the
public schema was checked against `pg_index` for whether it's the
*leftmost* column of any existing index (the only way an index actually
helps a plain lookup on that column) — found and added 50 genuinely
missing FK indexes, dropped 1 real duplicate (`idx_daily_snapshots_date`,
redundant with the table's own UNIQUE constraint index), added
`created_at desc` indexes to the 16 tables whose list pages sort by it
with no index behind it at all, and added a case/whitespace-insensitive
unique index on `parties.legal_name` (a real duplicate-client/-supplier
risk this business already manages manually — zero existing collisions
confirmed before adding it).

**A.2 — Pagination.** The 10 core transactional list pages (Queries,
Quotations, Sales Orders, Purchase Orders, Jobs, Invoices, Supplier
Bills, Payments, Expenses, Delivery Challans) used to fetch every row of
the table on every page load. They now fetch 25 rows at a time via
Supabase's `.range()` with `{count: "exact"}`, rendering a shared
`<PaginationControls>` component that preserves every existing filter
(date range, status, etc.) across page links. Jobs is the one special
case: its "health" badge is computed in JS from `required_delivery_date`
+ `updated_at` (not a DB column), so DB-level `.range()` pagination would
silently return incomplete results whenever the health filter is active
— when it is, the page instead fetches every status-filtered row, applies
the health filter, and paginates the already-filtered array in memory;
when it isn't, it paginates at the DB level like every other page.

**B — Smart Merge.** Replaces "reject the whole save if anything on the
row changed" with field-level 3-way conflict resolution: a field nobody
else touched is always safe to save regardless of what else changed on
the row, and only a field two people changed to two *different* values
is held back for a decision — every other field the user changed is
still applied in the same request. This app's business documents
(queries → quotations → sales orders → jobs → delivery → invoices →
payments) are append-only workflow documents — created once, then moved
through fixed state-machine actions (cancel, amend-as-a-new-revision,
record POD, allocate payment, …), each already targeting its own
distinct columns via its own dedicated RPC — so there's no free-form
"edit this record's fields" UI on those to protect in the first place.
The two places in the app that *are* genuine edit-anytime, multi-field
forms on an existing row — **Company Profile** and **Party Credit
Terms** — are exactly where Smart Merge is wired in, through one
generic, reusable engine any future free-edit form can opt into with a
one-line addition to its allowlist:
- `fn_smart_merge_update(table, row_id, base, changes)` — `base` is the
  row as the browser last loaded it, `changes` is only the fields it's
  actually trying to change. For each changed field: current value
  already equals the new value → no-op; current value still equals
  `base` → nobody else touched it, apply it; otherwise → genuine
  conflict, left untouched and reported back (`{field, base_value,
  server_value, my_value}`) while every other, non-conflicting field
  the user changed is still applied in the same statement.
- A per-table allowlist of editable columns (`company`:
  legal_name/ntn/strn/address/province/phone/email/
  default_sales_tax_pct; `parties`: credit_limit/credit_days) is the
  hard security boundary — a table or column not on it can never be
  written through this path, whatever a client sends.
- Runs with the *caller's own* privileges (not SECURITY DEFINER), so
  the table's normal RLS UPDATE policy still decides who may write —
  Smart Merge sits on top of the existing permission model, never
  around it.
- A type-aware value-equality check means `"18"` vs `18.00` (a
  `numeric(5,2)` column's own text formatting vs. what a browser last
  displayed) is correctly treated as "unchanged", never a false
  conflict.
- The conflict UI ("Mera value rakhen" / "Server ka value rakhen") ships
  on both forms — resolving "mine" resubmits with the base advanced to
  the server's current value; resolving "theirs" just accepts it.
- `row_version` (present on 9 tables since Phase 0/1/2/3/5, but never
  actually read or written by any application code before this) is now
  genuinely incremented on every Smart-Merge-applied write, on the
  tables that have it — an optional optimization the engine detects
  per-table, not a requirement (`company` has no `row_version` column
  at all and is handled the same way).

**A.3 — PWA shell.** `public/manifest.webmanifest` + `public/sw.js` +
`public/offline.html`, registered from the root layout
(`ServiceWorkerRegister`) with a dismissible "naya version available"
toast when a new service worker has finished installing in the
background (the user decides when to reload, never a silent swap
mid-edit). Caching strategy: HTML navigations are **network-first**
(always try live data first; fall back to cache, then the offline page,
only when genuinely offline); Next's static build output
(`/_next/static/*`, images, fonts, icons) is **cache-first with a
background refresh** (stale-while-revalidate); every non-GET request
(Server Actions, RPC calls) and every cross-origin request (Supabase's
REST/Auth/Storage API) is **never** touched by the service worker at
all — business data must always be live, never served from a cache.
The cache is versioned (`hitech-v1`) and `activate` deletes every
older-versioned cache, so nothing stale survives a deploy.
- **Bug found and fixed while building this**: the app's `proxy.ts`
  (Next.js 16's renamed `middleware.ts`) redirected an unauthenticated
  request for `/sw.js`, `/manifest.webmanifest`, and `/offline.html` to
  `/login` — its matcher excluded images and `_next/*` but not these new
  static files, which would have made the service worker completely
  unregisterable. Fixed by adding them to the matcher's exclusion list;
  verified with a real production build + server, confirming all three
  now return 200 with the right content-type while `/` still correctly
  redirects when signed out.

**A.4/5 — Local-first optimistic UI + offline write queue.** A
dependency-free IndexedDB-backed queue (`src/lib/offlineQueue.ts`)
persists a write across reloads when the browser is offline. Scope
mirrors Smart Merge's for the same reason — Company Profile and Party
Credit Terms are the only two free-edit forms to route through it —
which also means every queued write, by construction, replays through
the *exact same* `fn_smart_merge_update` conflict-aware RPC an online
save uses, per the prompt's own explicit dependency note: never a blind
overwrite just because it happened to be queued.
- Saving while offline queues the diff instead of failing outright, and
  shows a small "⏳ Offline save — sync ka intezar" indicator right on
  the form.
- `OfflineQueueProvider` (wrapping the whole authenticated app) flushes
  the queue automatically on the browser's `online` event and on first
  mount if already online — a floating status pill shows "Offline — N
  changes pending sync" while offline, and a toast summarizes the
  result once back online.
- A synced write that comes back with a genuine conflict (someone else
  changed the same field while this browser was offline) surfaces the
  identical Mera/Server resolution UI as an online save's conflict —
  never a silently-dropped edit.

</details>

<details>
<summary>Phase 17 — Daily Backup & Restore (complete)</summary>

Every night, without any human action, the system emails two files: an
Excel workbook (for a person to read) and a JSON file (for a full
disaster-recovery restore) — plus an in-app admin feature to actually
restore from that JSON.

- **Runner** — `backup/backup.js`, a standalone Node script with its own
  `package.json` (`@supabase/supabase-js`, `exceljs`, `nodemailer`),
  deliberately kept **outside** the Next.js app bundle (it runs headless
  via CI, never in a browser). `.github/workflows/daily-backup.yml`
  schedules it daily at 21:00 UTC (02:00 AM PKT — after the Karachi
  business day ends and after the Phase 15 Daily Snapshot has already
  run) plus a `workflow_dispatch` manual-run button.
- **Authentication — a dedicated, low-privilege account, never a
  service-role key.** A real `Backup Bot` Supabase Auth user signs in
  the same way any app user does (email + password), holding only two
  roles: the existing **`auditor`** role, and a brand-new **`backup`**
  role added specifically for this feature. Between them these unlock
  read access to every one of this app's 60+ tables — almost all of
  which already carry a universal `p_select using(true)` policy; the
  small number of tables that don't (`journal_entries`/`journal_lines`/
  `audit_log`/`login_sessions` via `auditor`; `import_batches`/
  `user_roles` via the new `backup` role) got the minimum additive RLS
  grant needed and nothing more. This account cannot write anywhere in
  the app — no financial posting, no master-data changes, nothing.
- **Resilient, ordered fetch** — one dependency-ordered table list
  (`RESTORE_TABLE_ORDER`, parents before children — computed once via a
  topological sort of the live FK graph, duplicated deliberately in
  `backup/backup.js` and `src/lib/restoreTableOrder.ts` since the
  backup script intentionally isn't part of the app bundle) is fetched
  table-by-table; **one table failing never aborts the rest** — it's
  recorded in `missed[]` and backfilled with an empty array, and only a
  total failure (bad login, no connectivity) throws. A `missed[]`
  non-empty backup prefixes its email subject with `⚠ INCOMPLETE —` and
  sets a non-zero exit code (red CI run) — two independent, hard-to-miss
  signals, on top of the email body naming exactly which table(s) failed
  and why.
- **Excel workbook** — 15 sheets built from the raw fetched tables
  (Trial Balance and AR/AP Aging computed the same way the app's own
  `trial_balance` view / `src/lib/aging.ts` do, so the backup always
  matches what a user sees in the app; Journal, Parties, Items, Current
  Stock, Sales/Purchase Orders, Invoices, Supplier Bills, Payments,
  Expenses, Jobs, Delivery Challans).
- **JSON restore file** — `{format: "hitech-restore", version, taken_at,
  taken_at_karachi, data_date, order, missed, counts, tables}` — every
  row of every table, unfiltered (including cancelled/inactive rows —
  a restore needs real history, not just what today's UI shows).
- **Restore feature** — `/setup/backup-restore` (Owner-only). Upload the
  JSON → **plan preview first** (per-table add/update/delete counts,
  computed read-only by `fn_admin_restore_plan`) → choose **Merge**
  (only adds rows missing from the live database, never touches or
  deletes existing ones) or **Replace** (makes the database match the
  file exactly, including deletions) → **automatically downloads a
  fresh safety snapshot of the current database** the moment you start
  confirming, before anything is touched → type `RESTORE` to unlock the
  commit button → per-table result report. The actual writes go through
  two new SECURITY DEFINER functions, `fn_admin_restore_delete_orphans`
  and `fn_admin_restore_upsert` — both `is_owner()`-gated and restricted
  to a hardcoded table allowlist (`_fn_restore_pk_columns` doubles as
  that allowlist, returning `null` — reject — for anything not on it),
  using Postgres's own type-checked `jsonb_populate_recordset()` rather
  than any string-built value interpolation, so a malformed file fails
  type conversion instead of ever executing as SQL. A **Replace**
  restore runs deletes in *reverse* dependency order and upserts in
  *forward* order — a child row's FK must never block deleting its
  soon-to-be-gone parent, and a child row can't be inserted before the
  parent it references exists. One table failing never stops the rest;
  the end-of-run report says exactly which tables succeeded and which
  didn't, and never claims a full restore when something failed.
  `numbering_sequences` (the app's own document-numbering counters) is
  itself just a normal table in this schema — restoring it via the same
  mechanism as everything else already gets the "continue numbering
  after restore" behavior for free, with no separate sequence-fixup
  step needed.
- **Bug found and fixed while building this**: `fn_record_pod` was
  inserting an `activity_timeline.event_type` value the table's own
  CHECK constraint didn't allow at all — see the standalone fix note
  above. Also `jobs.responsible_user_id` pointed at the wrong table —
  see that fix note too. Both were only ever exercised for the first
  time while seeding real data to test this phase's own work, and are
  now fixed at the database level.

**Required secrets** (GitHub repo → Settings → Secrets and variables →
Actions): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (same ones the app itself
uses — never a service-role key), `BACKUP_EMAIL` / `BACKUP_PASSWORD`
(the dedicated Backup Bot account's login), `GMAIL_USER` /
`GMAIL_APP_PASSWORD` (a Gmail account + its App Password, for sending),
`BACKUP_TO_EMAIL` (where the nightly email should land).

</details>

<details>
<summary>Phase 16 — Owner Dashboard Redesign (complete)</summary>

Rebuilt the Owner Dashboard (`/reports`) to the Owner-approved reference
layout — same structure and management-view hierarchy as the reference
design, restyled entirely in the app's own theme (existing colors, cards,
tables, status badges, typography — no new visual language introduced).

- **Top filters** — Today/This Week/This Month/Custom date range, and
  All/Material Supply/Fabrication business-line toggle, both as plain
  query-param links (`?range=`, `?line=`, plus `?from=`/`?to=` for
  Custom) so every view is a shareable/bookmarkable URL, consistent with
  how every other filtered report in this app already works. Queries and
  Quotations have no `business_line` column of their own (a business
  line is only decided once a Sales Order exists), so the line filter
  honestly applies only to Sales Order/Job/Delivery/Receivable numbers —
  stated directly in the UI rather than silently doing nothing.
- **10 top KPI cards** exactly as specified — Queries Received,
  Quotations Sent, PO Received (a client's own PO becomes a Sales Order
  here, via `client_po_number`/`po_date`), Quotation→PO Conversion %,
  Pending Deliveries, Payments Received, Receivables, Payables, Cash &
  Bank, Raw Material Stock Value — every card a link that opens the
  underlying records (per UX rule #5), not just a static number.
- **4 management charts**, hand-built as theme-aware inline SVG/CSS
  (`TrendLineChart`, `CompareBarChart`) rather than adding a charting
  library — zero bundle-size cost, and colors are literal `var(--...)`
  references so the charts repaint correctly in dark mode with no extra
  code: Queries vs Quotations vs PO Trend (daily buckets, switching to
  weekly beyond 31 days so a large Custom range still renders legibly),
  Material Supply Orders vs Fabrication Jobs in Progress, Receivables vs
  Payables, and a Cash & Bank / Financial Trend line sourced from the
  Phase 15 `daily_snapshots` history.
- **Operational sections** — Recent Queries, Recent Quotations,
  Fabrication Jobs Status, Pending Deliveries, Payment Follow-ups — live
  mini-tables embedded directly on the dashboard (not just counts), each
  with a "Sab dekhen →" link to its full page/report.
- **Owner control sections** — **Action Required** (all 9 named alert
  types: Credit Limit Warning, Quotation Follow-up Due, Material
  Purchase Pending, Raw Material Shortage, Job Delayed, Delivery
  Overdue, Client Acceptance Pending, Invoice Pending, Payment Overdue —
  three of these needed brand-new drill-down reports since nothing
  existing showed exactly that list: `/reports/credit-limit-warning`,
  `/reports/quotation-followups`, `/reports/raw-material-shortage`);
  **Order Health** collapsed to the requested 3 buckets (On Track /
  Attention Required / Delayed) from the existing 4-label
  `computeHealth()` engine (Attention Required = At Risk + Stalled);
  **Pending From Whom?** (Client/Supplier/Purchase/Fabrication/Accounts
  counts); **Daily Owner Summary** reusing the latest Phase 15 snapshot.
- **Real drill-down, not decoration** — 7 existing list pages
  (Queries, Quotations, Sales Orders, Payments, Jobs, Delivery
  Challans, Purchase Orders) gained small, additive, optional
  query-param filters (`from`/`to`, `status`, `direction`, `acceptance`,
  `open`, `health`) purely so a dashboard number can link straight to
  the exact filtered list instead of a generic unfiltered page — every
  new param is optional and ignored when absent, so every existing
  link/bookmark keeps behaving exactly as before.
- New `src/lib/dashboardHelpers.ts` (date-range resolution, daily/weekly
  bucketing for the trend charts) ships with its own `.test.ts`,
  matching the existing `aging.ts`/`orderHealth.ts` pattern of pure,
  independently-tested shared logic.

**Scope note:** at the time this page was written the connected database
had zero seeded rows, so every query shape, FK relationship and column
name was independently confirmed against the actual schema
(`pg_constraint`, `EXPLAIN`) rather than by eyeballing rendered numbers.
A realistic demo dataset (5 clients/suppliers, 5 raw-material items, a
full Material Supply and Fabrication order cycle each, an overdue/over-
credit-limit invoice, a material-shortage-blocked job, a pending-
acceptance delivery, 21 days of Daily Snapshot history) was seeded
directly afterward to actually exercise every dashboard number end to
end — see the bug fix note immediately below, found only because of
that exercise.

**Bug fix (found while seeding real data):** `fn_record_pod` inserted
`activity_timeline.event_type = 'pod'`, a value the table's own CHECK
constraint doesn't allow (only `note`/`status_change`/`followup`/
`system`) — so recording a Delivery Challan's Proof-of-Delivery with a
note attached would fail and roll back the entire POD (including the
Accepted status update), for every real user, every time. This had
never been caught because the app had zero real production usage until
this seeding exercise ran the actual RPC path for the first time.
Fixed in `20260912040254_fix_fn_record_pod_event_type.sql` — the
function now writes `'status_change'` (the same value
`fn_cancel_sales_order` already uses for its own status-change timeline
entries).

**Bug fix #2:** `jobs.responsible_user_id` referenced `auth.users(id)`,
unlike every sibling "assigned/responsible person" column elsewhere in
this schema (`tasks.assigned_to`, `vehicles.assigned_user_id`,
`petty_cash_funds.custodian_user_id`), which all correctly reference
`public.profiles(id)`. Because of that mismatch PostgREST had no valid
relationship path at all to embed `profiles(full_name)` from `jobs` —
so the Job Detail page's own query silently failed and the page
rendered as a 404 for every single job. Fixed in
`20260912052123_fix_jobs_responsible_user_id_fk_target.sql` by
re-pointing the FK to `public.profiles(id)`, the same pattern already
used correctly by the three sibling columns above.

**Bug fix #3 (pre-existing, not specific to this phase):** the app's
sidebar (`<aside className="hidden md:flex ...">`) had no phone-width
fallback at all — below the `md` breakpoint the entire navigation
disappeared, leaving only Home and Logout reachable. Fixed by adding
`src/components/MobileNav.tsx` — a sticky top bar (visible only below
`md`) with a hamburger button opening a slide-in drawer carrying the
exact same nav list, search box, user info and Logout the desktop
sidebar already has, in the same design system.

</details>

<details>
<summary>Phase 15 — Controls & Permissions (complete)</summary>

Four independent controls, bundled together on the Owner's request:
**Period Lock**, **Daily Snapshot**, **Stock Transfer** between
warehouses, and a **configurable Permission Matrix**.

- **Period Lock** — a single `company.period_lock_date`; once set, *no*
  financial posting anywhere in the system may date on or before it,
  enforced in exactly one place: the very first statement of
  `_fn_post_journal_entry_core`, the one function every posting path in
  the whole system (Invoice, Bill, Payment, Expense, Transfer, JV,
  Sales/Purchase Return, Stock Transfer's own non-GL path aside) already
  routes through — so the guarantee is structural, not a per-screen
  check that a future document type could forget. Absolute even for the
  Owner once set; the Owner can always move or clear the lock itself via
  a dedicated `fn_set_period_lock` (Owner-only), and the existing
  `trg_audit` on `company` already records who changed it and when, so
  no separate history table was needed. **`/setup/period-lock`** (Owner
  only).
- **Daily Snapshot** — a `daily_snapshots` table capturing one row per
  day: Cash in Hand, Bank, Petty Cash, Stock Value, AR/AP outstanding,
  and that day's Sales/Collections/Payments/Expenses totals.
  `fn_generate_daily_snapshot` can be run manually (Owner/Accounts) and
  is also **scheduled automatically via `pg_cron`** at 00:10 daily for
  the previous day (`current_date - 1`, guaranteeing every transaction
  for that day is already posted) through a privilege-revoked wrapper
  function with no role check (the cron job has no signed-in
  `auth.uid()`) that is not reachable via the API. **`/reports/daily-snapshot`**
  shows the latest snapshot as stat tiles plus a 90-day history table
  (Owner/Accounts to generate, +Auditor to view).
- **Stock Transfer** — warehouse-to-warehouse stock movement
  (`fn_create_stock_transfer` / `fn_cancel_stock_transfer`, new `STN`
  document numbering). Confirmed `1310 Raw Material Inventory` is a
  single company-wide GL account with no warehouse dimension, so a
  transfer is **pure `stock_ledger` movement with zero journal entry**
  — simpler than every other stock-moving document in the system: a
  negative leg at the source (at its current average cost) and a
  matching positive leg at the destination at that same cost, guarded by
  the existing negative-balance check inside `_fn_post_stock_ledger`.
  **`/stock-transfers`** (Owner/Store, or per the Permission Matrix
  below).
- **Configurable Permission Matrix (Option A — app-layer, DB stays the
  safety floor)** — a `role_permissions` table lets the Owner
  restrict or (re-)grant, per non-Owner role, exactly which roles may
  perform each of **19 core transactional create/cancel/manage actions**
  (Query, Quotation, Sales/Purchase Order, Delivery Challan (+dispute),
  Product Template, Job (+material handling), Invoice, Supplier Bill,
  Payment, Expense, Fund Transfer, Journal Voucher, Sales/Purchase
  Return, Stock Adjustment request, Stock Transfer). Every one of those
  19 actions still ends at the *same* SQL function it always did,
  carrying its **own original hardcoded role check as an unchangeable
  floor** — the matrix can only narrow or restrict *within* what the
  database already allows for that action, never grant a role the
  database would reject; the Owner is always implicitly allowed and is
  never stored in the table. Deliberately **out of scope**: master-data
  CRUD (Items, Clients, Warehouses, Vehicles, Bank Accounts, Petty Cash,
  Chart of Accounts, CSV Import — these stay on their existing stable
  Owner(+role) checks) and report-view gates (unaffected). Both Server
  Actions (a new `hasPermission(user, key)` check as the very first
  statement of each covered action) and the corresponding page-level
  UI gates were converted; **`/setup/permissions`** (Owner only) renders
  the matrix as a checkbox grid, greying out any cell the database
  itself would refuse.

**Scope note:** Rate History remains on the gap list; WHT, Advance
Payments, Bank Reconciliation, Scrap tracking and Document Expiry
alerts remain explicitly optional per the original prompt.

</details>

<details>
<summary>Phase 14 — Sales & Purchase Returns (complete)</summary>

Closing the sixth item on the gap list found by the Phase 9 re-audit:
**Returns / Rejection / Replacement** (prompt's Sales Return and Purchase
Return asks). "Rejection" at receiving time was already covered by GRN
short/excess tracking since Phase 3; "Replacement" is deliberately **not**
a separate transaction type — it's a Return followed by a normal new
Delivery Challan/GRN of the replacement stock, reusing everything that
already exists instead of duplicating the reversal logic for what is
really the same reverse-then-forward flow.

- **Design**: both Return types are tied to the specific financial
  document that first booked the money — a **Sales Return** (credit
  note) always references a Posted **Invoice**; a **Purchase Return**
  (debit note) always references a Posted **Supplier Bill** — exactly
  mirroring how a real credit/debit note works, and reusing the same
  `invoiced_qty`/`delivered_qty`-style running-counter pattern already
  used everywhere in this schema (`invoice_lines.returned_qty`,
  `supplier_bill_lines.returned_qty`). Purchase Return is scoped to
  `stock`-type purchases only — the only type that goes through a
  separate Supplier Bill and actually moves inventory; a `direct`/
  `general` purchase books its Payable straight off the GRN with no
  stock effect, so a correction there is a Journal Voucher (already
  exists from Phase 9), not a stock-reversing Return.
- **`fn_create_sales_return`** — reverses Sales Revenue + Output GST +
  Trade Receivables at the invoice's own rate, and adds the returned
  stock back at the warehouse's **current average cost** (persisted per
  line so a later cancellation reverses the exact same amount rather
  than recomputing against a since-changed avg cost).
  **`fn_create_purchase_return`** — reverses Trade Payables + Input GST
  + Raw Material Inventory at the bill's own rate (the return is a
  precise reversal of a specific already-recorded transaction, not a
  weighted-average-cost event, so no avg-cost lookup is needed on this
  side). Both have a matching `fn_cancel_*` function, and `fn_cancel_invoice`
  / `fn_cancel_supplier_bill` now refuse to cancel a document that still
  has a Posted return against it.
- **`invoice_outstanding` / `supplier_bill_outstanding` widened** (one
  new `returned_amount` column, existing columns untouched) to net
  Posted returns against their document — AR/AP Aging, Customer 360,
  credit-limit checks, and the Owner Dashboard's receivable/payable
  totals all pick this up automatically with no changes of their own,
  since they only ever read `outstanding_amount`.
- **`/sales-returns`** and **`/purchase-returns`** — list + detail pages;
  creation happens contextually via a **`SalesReturnPanel`** /
  **`PurchaseReturnPanel`** embedded directly on the Invoice / Supplier
  Bill detail page (pick qty per line, same "receive what actually
  happened" pattern `ReceiveGrnPanel` already uses for GRNs).

</details>

<details>
<summary>Phase 13 — Order Health, Stage Aging &amp; Tasks/Follow-ups (complete)</summary>

Closing the fifth item on the gap list found by the Phase 9 re-audit:
**Order Health Indicators, Stage-wise Aging, and Tasks & Follow-ups**.
No new posting logic — Order Health/Stage Aging is pure app-layer
computation off existing columns; Tasks & Follow-ups is one new table.

- **Order Health** (`src/lib/orderHealth.ts`, unit-tested in
  `orderHealth.test.ts`) — every open Sales Order / Purchase Order / Job
  gets a health flag: **On Track**, **At Risk** (promised date within 3
  days), **Delayed** (promised date already passed), or **Stalled** (10+
  days with no stage movement and no promised date to judge by yet).
  "Days in current stage" is `now() − updated_at` — every status change
  already runs through a plain `UPDATE`, which the existing
  `trg_updated_at` trigger stamps, so this needed no new stage-history
  table. A true stage-by-stage history (recording exactly when each
  individual status was entered) would be a materially bigger feature;
  this is a documented scope choice, not an oversight. Health badges now
  show directly on the Sales Orders, Purchase Orders, and Jobs list
  pages (a new "Health" column on each).
- **`/reports/order-health`** — Stage Aging dashboard: every open SO/PO/
  Job in one place, worst health first, with days-in-stage and the
  promised date it's being judged against.
- **Tasks & Follow-ups** (`tasks` table, new) — an assignable,
  closeable to-do, distinct from the free-form `activity_timeline` notes
  that already existed on Queries/Jobs (those stay as a running log with
  their own optional follow-up date; this is an explicit task with an
  owner, a due date, and a real Open → Done/Cancelled lifecycle).
  `related_table`/`related_id` optionally link a task to any Sales
  Order, Purchase Order, Job, or Client/Supplier — same generic-
  dimension pattern `activity_timeline.owner_table/owner_id` already
  uses. `fn_create_task`/`fn_update_task`/`fn_complete_task`/
  `fn_reopen_task`/`fn_cancel_task` enforce who can do what: anyone
  signed in can create a task and assign it to anyone; the assignee,
  the creator, or Owner can complete/reopen it; only the creator or
  Owner can edit or cancel it.
  - **`/tasks`** — company-wide task list (My Tasks / All Open /
    Overdue / Due Today / Upcoming / Completed), each row linking back
    to its entity.
  - **`/tasks/new`** — standalone creation, optionally linked to a
    Sales Order / Purchase Order / Job / Client picked from a dropdown.
  - **`/tasks/[id]`** — detail, edit (while Open), and actions.
  - A **`TasksPanel`** component is embedded directly on the Sales
    Order, Purchase Order, Job, and Client detail pages — add or manage
    a task for that specific record without leaving its page.
  - Sidebar gained a **Tasks & Follow-ups** link with a live badge
    count of the signed-in user's own overdue-or-due-today tasks, plus
    an **Action Required** card on the Owner Dashboard (Open Tasks /
    Overdue Tasks, with a link into the Order Health report).

**Scope note:** Returns/Rejection/Replacement, Rate History, Period
Lock, Daily Snapshot, Stock Transfer between warehouses, and the
configurable permission matrix remain as separate upcoming phases.

</details>

<details>
<summary>Phase 12 — Reports &amp; Global Search (complete)</summary>

Closing the fourth item on the gap list found by the Phase 9 re-audit:
the rest of the requested operational Reports (§58), **Global Search**
(§56) and **Excel Export** (§58) across the reports that most needed it.
Purely additive — no new tables, no changes to any posting function;
every new page is a read-only query over existing tables/views.

- **`/reports/pending-orders`** — merges the prompt's separate "Pending
  Order Report" and "Pending Delivery Report" into one page: every
  Sales Order line still owing a delivery and/or an invoice, oldest PO
  first, with a Days-Since-PO column flagged red past 30 days.
- **`/reports/purchase-pending`** — the Purchase-side mirror: every PO
  line still owing a GRN, sorted by days overdue against its expected
  delivery date.
- **`/reports/grn-report`** — date-range GRN/Receiving register with
  short/excess counts, per the prompt's Receiving Report ask.
- **`/reports/payment-collection`** — date-range collection report,
  split receipts vs disbursements, grouped by payment method and by
  top-10 clients, plus the full transaction list.
- **`/reports/customer-business`** — Customer-wise Business Report:
  every client's order count/value, invoiced total, and outstanding, in
  one sortable table (biggest client first).
- **`/reports/order-status`** — Order-wise Status: pick one Sales Order
  and see its entire journey in one place — Query → Quotation → Sales
  Order → Fabrication Jobs (if applicable) → Delivery Challans →
  Invoices → Payments — the prompt's "Order Journey Tracking" ask.
- **`/search`** — Global Search (§56): one search box in the sidebar,
  searches Parties/Queries/Quotations/Sales Orders/Purchase Orders/
  Jobs/Delivery Challans/Invoices/Supplier Bills/Items/Vehicles in
  parallel, grouped results with direct links. User input is sanitized
  (commas/parens stripped) before being used to build a PostgREST
  `.or()` filter, since those characters are structural separators in
  that filter syntax and an unsanitized search string could otherwise
  break the query.
- **Excel Export** added to AR Aging, AP Aging, Trial Balance, Pending
  Orders, Payment Collection, and Customer Business reports — a shared
  `buildExcelResponse()` helper (`src/lib/excelExport.ts`, using the
  existing `exceljs` dependency) backs a Route Handler per report, each
  with its own auth guard mirroring the page's access control (Route
  Handlers bypass page-level render guards, so the check is repeated
  explicitly rather than assumed).
- **Warehouse-wise Stock** (§58) — satisfied by adding a warehouse
  filter to the existing `/inventory` page rather than building a
  duplicate report, since that page already showed item × warehouse
  on-hand/reserved/free/avg-cost/value.
- **Quotation → Sales Order Conversion %** — new stat tile on the Owner
  Dashboard (`/reports`), alongside Queries Received and Quotations
  Sent counts, answering the prompt's explicit "Kitni Quotations PO me
  convert hui?" question.

**Scope note:** Order Health/Stage Aging, Tasks & Follow-ups, Returns/
Rejection/Replacement, Rate History, Period Lock, Daily Snapshot, and
the configurable permission matrix remain as separate upcoming phases.

</details>

<details>
<summary>Phase 11 — Financial Statements (complete)</summary>

Closing the third item on the gap list found by the Phase 9 re-audit:
**Profit & Loss Statement, Balance Sheet, Cash Flow/Position, and proper
running-balance Customer/Supplier/General Ledgers** (prompt §42, §50).
Purely additive reporting — no new tables, no changes to any posting
function; every figure is computed live off the same `journal_lines` /
`chart_of_accounts` this system has posted to since Phase 0.

- **`/reports/profit-loss`** — Revenue → COGS → Gross Profit → Operating
  Expenses → Net Profit, for a date range (defaults to the current
  fiscal year, matching the July–June FY convention this system's
  numbering already uses). Every expense head from Phases 9-10 rolls up
  automatically since they're all real chart-of-accounts children.
- **`/reports/balance-sheet`** — Assets / Liabilities / Equity, live
  snapshot (no historical "as of date" yet — noted as a scope limit,
  not silently glossed over). Equity includes **Retained Earnings**
  (accumulated Net Profit) since this system never runs a period-close
  — the identity `Assets = Liabilities + Equity` is asserted and
  flagged red on the page itself if it ever fails to hold.
- **`/reports/cash-flow`** — Cash in Hand + Bank Accounts + Petty Cash
  combined: opening/receipts/payments/closing for a date range, per
  account and as a running-balance transaction list — this single page
  covers the prompt's Cash Flow, Cash Book, and Bank Book requirements
  together rather than as three separate reports.
- **`/reports/party-ledger`** and **`/reports/general-ledger`** — pick
  any client/supplier or any chart-of-accounts code and get its full
  running-balance history — the Customer Ledger / Supplier Ledger /
  General Ledger the prompt asked for, as one parametrized report each
  instead of one page per party.
- **Company Capital/Equity vs Working Capital**, now on the Owner
  Dashboard (`/reports`) — the prompt explicitly warns against
  conflating Cash Balance with Company Capital; Company Capital here is
  genuine Equity + Retained Earnings, Working Capital is Total Assets −
  Total Liabilities (flagged as an approximation, since this chart of
  accounts doesn't yet distinguish current vs non-current — everything
  in it today effectively is current).
- **A real pre-existing classification bug found and fixed**: `1900
  Opening Balance Equity` had been seeded back in Phase 0 with
  `account_type='asset'` instead of `'equity'` — harmless until now
  since nothing grouped accounts by type before, but it would have
  silently misclassified every opening-balance entry on the new Balance
  Sheet. Fixed as a pure label correction (no transactional data or
  balances touched).
- **A lint rule caught during this phase**: three new report pages
  computed a running balance by mutating a loop variable while mapping
  rows for render (`react-hooks/immutability`, part of this project's
  existing lint config) — refactored to compute the running-balance
  array once via `reduce` before rendering, in all three pages.

**Scope note:** Order Health/Stage Aging, Tasks & Follow-ups, Returns/
Rejection/Replacement, Rate History, Period Lock, Daily Snapshot, the
rest of the requested operational Reports list, and the configurable
permission matrix remain as separate upcoming phases.

</details>

<details>
<summary>Phase 10 — Vehicle/Fleet & Engineer/Rider Expenses (complete)</summary>

Closing the second item on the gap list found by the Phase 9 re-audit
(§20 Vehicle/Fleet Management, §21 Engineer/Rider Expense Tracking).
Built as an **extension of Phase 9's Expense module**, not a parallel
system — a vehicle-linked expense is still just an Expense with a
`vehicle_id`, exactly the way a job-linked expense already worked.

- **`vehicles`** (new table) — Vehicle #, Registration #, Type, Make/
  Model, Assigned Engineer/Rider, Assignment Date, Opening/Current Meter
  Reading, Status (Active/UnderMaintenance/Retired/Unassigned). A DB
  check enforces current meter reading never goes below the opening one.
- **`/setup/vehicles`** (list + create) and **`/setup/vehicles/[id]`**
  (reassign, change status, meter reading, live totals, expense history,
  document attachments) — the Item-Master-detail-page pattern, reused.
- **10 more vehicle-specific Expense Heads** added from the prompt's own
  list (Oil Change, Tyres, Battery, Insurance, Token/Registration, Toll,
  Parking, Fine/Challan, Tracker, Accident) — Fuel/Repair/Maintenance/
  Miscellaneous already existed from Phase 9. Each auto-creates its own
  P&L account under `6000 Operating Expenses`, same mechanism as before.
- **`fn_create_expense` widened** (Vehicle, Meter Reading, Litres, Rate/
  Litre for fuel entries, Settlement Status) — a fuel/vehicle expense
  automatically advances the vehicle's live meter reading (only ever
  forward, never regresses, so a backdated entry can't corrupt it).
  Learned the exact lesson Phase 9 paid for with `fn_create_payment`:
  created the new signature and explicitly dropped the old one in the
  same migration/transaction this time, so no ambiguous overload was
  ever exposed.
- **Settlement Status** (§21) — a lightweight `Settled`/`Pending`
  tracking flag on each expense, deliberately **not** a full unsettled-
  staff-advance sub-ledger (that's a materially bigger, differently-
  shaped feature the prompt doesn't fully specify) — the expense still
  posts its real cash/bank/petty-cash movement immediately at entry,
  same as every other expense; "Pending" just flags it for someone to
  follow up on later.
- **Receipts/Attachments** on Expenses — the existing generic
  `AttachmentsPanel` (already used for DC/PO/Query/etc.) attached to the
  Expense detail page, closing that part of §21 with zero new code.
- **`/reports/vehicle-expenses`** — Vehicle-wise total/fuel/maintenance/
  Cost-per-KM (with the top-spending vehicle called out), plus
  Engineer/Rider-wise expense totals with a Pending-Settlement count —
  covers the whole §20 report list in one page rather than five.
- **A real gap in Phase 9 itself, found and fixed while planning this
  phase**: none of Phase 9's five new tables (`bank_accounts`,
  `petty_cash_funds`, `expense_heads`, `expenses`, `contra_transfers`)
  had the standard `trg_audit` / `trg_updated_at` triggers every other
  table in this schema carries — `audit_log` (prompt §35's actual
  mechanism) was silently not tracking any of them. Retrofitted in this
  phase's own migration, plus the same triggers on the new `vehicles`
  table from day one.

**Scope note:** this closes the Vehicle/Fleet + Engineer/Rider slice
only. Financial Statements (P&L/Balance Sheet), the rest of the
requested Reports, Order Health/Stage Aging, Tasks & Follow-ups,
Returns/Rejection/Replacement, Rate History, Period Lock, Daily
Snapshot, and the configurable permission matrix remain as separate
upcoming phases.

</details>

<details>
<summary>Phase 9 — Cash, Bank & Expense Management (complete)</summary>

A second, much larger "is everything actually complete against the
original prompt?" audit — this time reading the full original spec
back line by line, not just re-checking what had shipped — found that
several whole modules from the prompt were never built: Expense
Management, Petty Cash, Cash/Bank transfers (Contra entries), manual
Journal Vouchers, Vehicle/Fleet, Financial Statements (P&L/Balance
Sheet), most of the requested Reports, Order Health/Stage Aging, Tasks
& Follow-ups, Returns/Rejection/Replacement, Rate History, Period Lock,
Daily Snapshot, and a configurable permission matrix. Agreed with the
project owner to close these **phase by phase, carefully**, rather than
all at once. This phase closes the first group: **Cash & Bank
Management, Manual Journal Vouchers, Contra (fund transfer) Entries,
Expense Management, and Petty Cash** (prompt §17, §18, §19, §42's
Journal Voucher/Contra requirements).

- **Cash split into three real accounts** — `1100 "Bank / Cash"` was,
  since Phase 0, one combined account silently used for both cash and
  every bank transaction. Split into `1050 Cash in Hand` (plain),
  `1100 Bank Accounts` (control, sub-ledger = new `bank_accounts` table,
  supports **multiple named bank accounts**, dimensioned by a new
  `journal_lines.bank_account_id` column — the exact same pattern
  `party_id` already uses for AR/AP), and `1060 Petty Cash` (control,
  sub-ledger = new `petty_cash_funds` table, supports **multiple
  custodians/locations**, same dimensioning pattern via
  `journal_lines.petty_cash_fund_id`). Both new master tables support an
  opening balance at creation (posts Dr the account / Cr `1900 Opening
  Balance Equity`, mirroring how party opening balances already work —
  no separate stored-balance field anywhere; every balance is always
  derived live from the ledger, matching this system's approach
  everywhere else).
- **`/cash-bank`** — live Cash in Hand / total Bank / total Petty Cash /
  grand total, plus a per-account and per-fund balance breakdown.
- **Expense Management** (`/expenses`, `/setup/expense-heads`) —
  configurable Expense Heads seeded with the prompt's own default list
  (Fuel, Transport, Loading, Office, Site, Repair, Maintenance, Salary,
  Utility, Miscellaneous); each head auto-creates its own P&L account
  under a new `6000 Operating Expenses` parent the moment it's added, so
  Setup stays a business-friendly list while accounting stays fully
  double-entry underneath. Every expense records its payment source
  (Cash / a specific Bank Account / a specific Petty Cash Fund) and can
  optionally link to a Job, a responsible person, and a department, per
  the prompt's requirement. Cancel reverses the posting, same pattern as
  every other document in this system.
- **Petty Cash** (`/setup/petty-cash-funds`) — multiple funds, each with
  its own custodian and live balance; Expenses can draw directly from
  any active fund.
- **Contra / Fund Transfers** (`/transfers`) — Cash↔Bank, Bank↔Bank,
  Bank↔Petty-Cash, any combination, in one screen; blocks a transfer to
  itself, posts a balanced 2-line journal entry tagged with both ends'
  dimension ids, cancellable (Owner only) with a reason.
- **Manual Journal Vouchers** (`/journal-vouchers`) — this RPC
  (`fn_post_journal_entry`) already existed, quietly, since Phase 0 (the
  Opening Balances import already called it directly) but had no UI
  until now; added a proper multi-line entry screen with a live
  Debit=Credit balance indicator, account + Party/Bank/Petty-Cash
  dimension pickers per line.
- **A real correctness gap closed in `_fn_post_journal_entry_core`
  itself** — the shared posting engine every single document type in
  this system funnels through had **never validated that debits equal
  credits**. Harmless as long as only pre-balanced, hardcoded jsonb from
  trusted server functions ever reached it (true for every caller before
  this phase) — but Journal Vouchers now let a human type arbitrary
  amounts directly into that same engine, so an unbalanced entry is now
  a real, guarded-against possibility. Added a hard `debit total = credit
  total` check (rounded to paisa) that raises before any entry posts.
- **A caught-before-shipping bug, same pattern as Phase 7's**: widening
  `fn_create_payment` with two new optional trailing parameters via
  `CREATE OR REPLACE` didn't replace the old 8-argument version — Postgres
  identifies functions by name **and** parameter signature, so it silently
  created a second overload, which would have made every existing
  `fn_create_payment` RPC call ambiguous the moment the frontend started
  passing the new arguments. Caught by inspecting `pg_proc` before calling
  the phase done; fixed with an explicit `drop function` on the stale
  8-arg signature, documented in its own migration rather than folded in
  silently.
- **Payments now know which specific account the money moved through**
  — `NewPaymentForm` gained an explicit Cash / Bank / Petty Cash source
  picker (replacing a free-text "Method" field that carried no real
  accounting meaning); `payments` gained `bank_account_id` /
  `petty_cash_fund_id` columns, and `fn_create_payment` /
  `fn_cancel_payment` post to the right specific account instead of the
  old always-1100 behaviour. A related fallback bug caught in the same
  review — the case where neither id is set now unambiguously means
  Cash in Hand (the UI always sends an explicit source), so the old
  "default to the Bank control account" fallback was corrected to
  default to `1050` instead, in its own follow-up migration.

**Scope note:** this phase is deliberately just the cash/bank/expense
slice of the larger gap list found in the re-audit above — Vehicle/
Fleet, Financial Statements, the rest of the Reports list, Order
Health/Stage Aging, Tasks, Returns, Rate History, Period Lock, Daily
Snapshot, and the permission matrix are tracked as separate upcoming
phases, not silently dropped.

</details>

<details>
<summary>Phase 8 — Multi-Unit Conversion (complete)</summary>

All 7 originally planned phases were completed, then a direct
"is everything actually complete against the prompt?" check turned up
one more real gap: items bought in one unit but sold/issued in another
(e.g. purchased in KG, sold in PCS) had no way to be entered correctly
— every unit field across Sales Order/Delivery Challan/Job material was
a free-text dropdown of *all* units, with zero conversion, so an alt
unit typed on a Sales Order line was silently treated as if it were the
item's base unit everywhere downstream, including stock postings.
Fixed, scoped exactly as agreed: **Sale/Issue/Delivery side only** —
Purchase Orders and GRN are completely unaffected and always stay in
`items.base_unit`.

- **`item_alt_units`** (new table) — per-item alternate units with a
  conversion factor to that item's `base_unit` (e.g. base_unit=KG,
  alt unit=PCS, factor=12 means 1 PCS = 12 KG). Deliberately separate
  from the existing global `unit_conversions` table (TON→KG etc.,
  which is item-agnostic) since these factors are item-specific — one
  bar's "1 PCS" is not another's. A trigger blocks an alt unit equal to
  the item's own base_unit (ambiguous double-entry). RLS mirrors
  `items`: anyone signed-in can read, Owner/Store/Production manage,
  Owner alone deletes.
- **Item Master detail page** (`/items/[id]`, new — the Item Master was
  previously a flat list with no per-item page at all) — shows the
  item's core fields and an **Alternate Units** panel to add/activate/
  deactivate/remove alt units, with the factor's meaning spelled out in
  plain language, not just a bare number.
- **Sales Order line entry** (`NewSalesOrderForm` / `SalesOrderAmendPanel`,
  both built on the shared `QuotationLineEditor`) — once an item is
  picked, the Unit dropdown is now restricted to that item's base_unit
  + its own active alt units, instead of every unit in the system
  (previously any unit could be picked for any item, with no relation
  to what the item actually supports — a latent correctness gap this
  closes). Quotation and Purchase Order line entry, which share the
  same editor component, are deliberately left untouched — the new
  restriction only activates when a caller opts in with an
  `altUnitsByItem` map, which only the Sales Order forms now pass.
- **Delivery Challan → stock posting** — the real conversion boundary.
  A Sales Order line can be ordered/delivered in an alt unit (e.g. PCS)
  while the warehouse tracks that item in its base_unit (e.g. KG); when
  "Issue from Stock" is checked, the form computes a base-unit-
  equivalent `stock_qty` client-side (`delivered_qty × factor`), shown
  live next to the qty field, and blocks submission with a clear error
  if the line's unit has no conversion factor set for that item rather
  than silently posting the wrong stock quantity. `delivery_challan_lines`
  gained a nullable `stock_qty` column; `fn_create_delivery_challan` and
  `fn_cancel_delivery_challan` were updated (same signatures — the new
  value rides through the existing `p_lines` jsonb parameter) to post
  and reverse stock/COGS off `stock_qty` when present, falling back to
  `delivered_qty` for lines where the order unit already equals the
  base unit (the common case) or for pre-existing rows. Invoicing
  needed **no changes at all** — invoice lines already copy the Sales
  Order line's unit/qty as-is, and COGS is booked once, at the DC's
  stock-posting boundary, never again at invoicing.
- **Job material requirement entry** (`NewJobForm`'s manual lines and
  `NewProductTemplateForm`'s BOM lines, both on the shared
  `MaterialLineEditor`) — required_qty / qty_per_unit must always be
  base_unit-denominated, because `fn_create_job`'s auto-reserve step and
  every later reserve/issue/return function compares it directly
  against `stock_availability.free_qty`, which is base_unit-tracked (no
  SQL changes needed there — they already treat their qty argument as
  base_unit-equivalent, so getting a correct value into them at entry
  is the whole fix). The Unit dropdown is now restricted the same way
  as Sales Order lines, and the entered qty is converted to base_unit
  client-side before the Server Action call, blocking with the same
  clear error if a conversion factor is missing. Reserve/Issue/Return
  actions on an already-created Job (`JobMaterialPanel`) needed **no
  changes** — by the time a requirement exists, it's already
  base_unit-denominated end-to-end, matching how the stock ledger
  itself is tracked; the conversion problem only exists at the point of
  first entry, which this phase closes.

**Scope note:** exactly what was agreed before building — Sale/Issue/
Delivery side only. Purchase Orders/GRN remain `base_unit`-only,
completely unchanged. Two new INFO-level (not ERROR) performance
advisories appeared after this migration (`item_alt_units.unit` and
`.created_by` foreign keys have no covering index) — left as-is,
consistent with dozens of pre-existing unindexed/unused-index INFO
findings already present across this schema; add if `item_alt_units`
grows large enough to matter.

</details>

<details>
<summary>Phase 7 — Hardening (complete)</summary>

All seven originally planned phases went live: Foundation → Query &
Quotation → Sales Order → Purchase/GRN/Inventory → Fabrication/Jobs →
Delivery/Invoicing/Payments → Customer 360/Credit Control/Reports →
this phase, which went back through Phases 0-6 looking for real bugs
rather than adding features — and found and fixed three.

- **Concurrency fixes** — two check-then-act races against live
  aggregates (not a single row a plain lock could protect), the same
  class of problem `_fn_post_stock_ledger` already solved for stock
  postings back in Phase 3:
  - `fn_reserve_job_material` / `fn_create_job`'s auto-reserve step read
    `stock_availability.free_qty` then inserted a reservation — two
    concurrent reserves on the same item+warehouse could each pass their
    own check and together over-reserve past what's actually free.
  - `fn_create_payment` / `fn_allocate_payment` read
    `invoice_outstanding`/`supplier_bill_outstanding` then inserted an
    allocation — two concurrent payments against the same Invoice/Bill
    could each see the same outstanding balance and together
    over-allocate it.
  - Both fixed with `pg_advisory_xact_lock`, keyed by item+warehouse or
    by invoice/bill id — the same pattern already proven in this
    codebase, not a new mechanism.
- **`fn_bootstrap_owner` race** — the one-time "claim Owner" call had
  the same check-then-act shape (two people signing up in the same
  instant could both become Owner); closed the same way, with a fixed
  advisory-lock key since there's no row yet to lock.
- **A caught-before-shipping regression**: the first hardening pass
  revoked direct `authenticated` access to `fn_get_next_number`
  (reasoning: no other document type calls it directly — every other
  `fn_create_*` wraps it internally, so revoking should have been
  transparent). Grepping the app code before calling it done turned up
  one real exception: `createQueryAction` (Phase 1) calls it directly,
  relying on the `queries` table's own RLS INSERT policy
  (`is_owner() or has_role('sales')`) as the actual authorization
  boundary. The revoke would have silently broken Query creation, so
  it's reverted — documented in the migration itself as a known,
  low-severity, pre-existing characteristic (any signed-in user can
  waste a sequence number for any doc type without ever being able to
  create the document behind it) rather than "fixed" by breaking a
  working feature. Reported as-is, not swept under the rug.
- **Security audit, clean** — every one of this project's ~44
  `SECURITY DEFINER` functions confirmed to have `search_path=public`
  set (blocks search-path-hijacking) and an explicit role check where
  one belongs; every table in `public` confirmed to have RLS enabled
  with at least one policy, no exceptions; both Storage buckets
  (`attachments`, `imports`) confirmed private with policies scoped to
  `authenticated` only (`anon` gets zero rows); `parties` deletion
  confirmed structurally safe — every transactional table referencing
  it uses `ON DELETE NO ACTION`, so Postgres itself refuses to delete a
  party with real history even though the RLS policy alone would allow
  the attempt.
- **Code-quality cleanup** — the AR-aging bucket logic existed as three
  separate copies (Customer 360, AR Aging report, AP Aging report);
  consolidated into `src/lib/aging.ts`, now covered by unit tests
  (`npm run test`, via a newly-added Vitest setup) — the first
  automated tests in this codebase, scoped to pure calculation logic
  that doesn't need a live database, since that's what this sandbox can
  actually run and verify.
- Added `(app)/not-found.tsx` and `(app)/error.tsx` so a bad link or an
  unexpected error renders inside the app's own shell instead of
  Next.js's generic default pages.
- **A genuinely missed promise, found and closed**: a direct
  "is everything actually complete?" completeness check against the
  original requirements — not just re-verifying what shipped — turned
  up that **Opening Stock import** (entity_type `opening_stock`) had
  been planned into `import_batches`' own check constraint since Phase
  0 and explicitly promised for Phase 3, but Phase 3 shipped without
  it and nothing since had circled back. Built now: `fn_import_opening_stock()`
  (item code + warehouse code + qty + rate, posts through
  `_fn_post_stock_ledger` and books Dr Raw Material Inventory / Cr
  Opening Balance Equity) plus the matching Import Wizard row type.
- **A4 print/PDF views for every formal document** — only the
  Quotation had one; the same completeness check flagged that GST
  Invoice, Delivery Challan, Purchase Order and Supplier Bill (all
  documents a real business prints, emails, or gets physically signed —
  Delivery Challan's whole POD step assumes a paper document exists)
  had none. Added standalone print routes for all four (`/invoices/
  [id]/print`, `/delivery-challans/[id]/print`, `/purchase-orders/[id]/
  print`, `/supplier-bills/[id]/print`), a "Print / PDF" button on each
  detail page, and pulled the print stylesheet (previously inlined only
  in the Quotation print page) into a shared `src/lib/printStyles.ts`
  with an explicit `@page { size: A4; margin: 15mm; }` rule — applied
  to the Quotation print page too, so paper size is now consistent and
  explicit everywhere rather than left to the visiting browser's
  default. Invoice's print includes each line's HS Code (FBR tax
  document); Delivery Challan and Invoice both carry a signature block.

**Scope note:** this pass is a **targeted audit**, not an exhaustive
one — it covered every `SECURITY DEFINER` function's privileges and
search_path, RLS coverage on every table, Storage bucket policies, FK
delete behavior around `parties`, and check-then-act races on the
functions most exposed to concurrent multi-user access (stock
reservation, payment allocation, owner bootstrap). It did not attempt
to re-derive or re-prove every business rule across all 6 prior phases
from scratch — those were each verified at the time they shipped. Full
live-auth browser/integration testing against the Supabase project
remains blocked by this sandbox's own egress policy (unchanged since
Phase 0) — the concurrency fixes above are reasoned from the function
bodies and Postgres's documented locking semantics, and precedented by
the identical pattern already proven correct in production-shape code
since Phase 3, but were not exercised under real concurrent load in
this sandbox.

</details>

<details>
<summary>Phase 6 — Customer 360 & Reports (complete)</summary>

Every client/supplier now has a single profile pulling together their
whole history and live financial position, credit exposure is visible
(and flagged) before it becomes a problem, and the accounting engine
built since Phase 0 finally surfaces as real reports.

- **Customer 360 Profile** (`/clients/[id]`) — one page per party:
  outstanding receivable/payable, credit limit/days, an AR aging strip,
  and every linked record (Queries, Quotations, Sales Orders, Delivery
  Challans, Invoices, Purchase Orders, Supplier Bills, Payments —
  whichever apply to that party's `client`/`supplier`/`both` type), each
  a clickable list straight into its own detail page.
- **Client Credit Control** — `credit_limit`/`credit_days` (on `parties`
  since Phase 0) are now load-bearing: Owner can edit them inline on the
  profile; Available Credit and an over-limit flag are computed live
  from `party_ar_summary`; creating a Sales Order shows a **soft
  warning** banner when that client is already at/over their limit —
  informative, never a hard block, consistent with this system's
  duplicate-PO-style philosophy throughout. AR/AP Aging (Current /
  1-30 / 31-60 / 61-90 / 90+, bucketed off each invoice/bill's own
  `invoice_date`/`bill_date` + that party's `credit_days`) is both on
  the profile and as a standalone report.
- **Reports** (`/reports`, gated to Owner/Accounts/Auditor — the same
  roles the blueprint's permission matrix already gives ledger access):
  - **Owner Dashboard** — a Material Supply / Fabrication / Combined
    toggle over Active Sales Orders, Order Value, Invoiced, Outstanding
    Receivable, and (Fabrication) Active Jobs — the split-and-combined
    view called for from day one of the design discussion.
  - **Daily Ledger / Day Book** — every journal entry for a chosen date,
    full debit/credit lines with account and party, day totals.
  - **AR Aging** / **AP Aging** — client-wise and supplier-wise
    outstanding in the same 5 buckets, with a balancing total row.
  - **Trial Balance** — every account's debit/credit rollup off the live
    journal, Dr/Cr-labelled by each account's normal balance side.
- Two new lightweight views (`party_ar_summary`, `party_ap_summary`) and
  one (`trial_balance`) — all `security_invoker=true` from the start,
  the lesson Phase 4 paid for the hard way. No new tables, no changes to
  any existing Phase 1-5 posting function: this phase is entirely
  additive and read-side.

**Scope note:** the credit-limit warning is a **pre-flight check in the
Sales Order creation page**, not an enforcement baked into
`fn_create_sales_order`/`fn_create_invoice` themselves — a deliberate
call to avoid touching those already-deployed, financially-live
functions for a check that's advisory by design (per the "warning, not
block" pattern this system already uses for duplicate POs). A
theoretical race between the check and the actual order isn't closed by
this, same as duplicate-PO detection isn't atomic either — acceptable
for a soft warning, not for something that must hold under concurrency.

</details>

<details>
<summary>Phase 5 — Delivery, Invoicing & Payments (complete)</summary>

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
time, aging, dashboards) was intentionally **not** in this phase — the
`credit_limit`/`credit_days` columns have existed on `parties` since
Phase 0 for exactly this, and it shipped with Phase 6 (Customer 360 &
Reports) alongside the Daily Ledger/Day Book, next to the rest of the
reporting suite rather than half-built here.

</details>

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
  Opening Receivables/Payables, and Opening Stock (item code + warehouse
  code + qty + rate — added in Phase 7, closing a gap left open since
  this note first said "arrives with Phase 3" and Phase 3 shipped
  without it), with a preview step and a per-import batch record
  (`import_batches`).

All 7 planned phases are now built — see the top of this README for
Phase 7 (Hardening).

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

```bash
npm run build   # production build + typecheck
npm run lint    # eslint
npm run test    # vitest — pure calculation logic (aging buckets), no DB needed
```

## Project layout

```
src/
  app/
    login/, signup/            — auth pages
    {quotations,invoices,delivery-challans,purchase-orders,
      supplier-bills}/[id]/print/
                               — standalone A4 print/PDF views (no sidebar chrome),
                                  one per formal document type
    (app)/                     — authenticated shell (sidebar, role-aware nav)
      bootstrap/               — first-run "claim Owner" screen
      clients/                 — client/supplier (party) management + [id]/ Customer 360
                                  Profile (credit terms, AR aging, every linked record)
      queries/                 — Query list, create, detail + activity timeline
      quotations/              — Quotation list, create (from a Query), detail
      sales-orders/            — Sales Order list, create (from a Quotation), detail + amendments
      items/                   — Item Master list + [id]/ detail page (Alternate Units for
                                  multi-unit Sale/Issue/Delivery conversion; Purchase/GRN
                                  always stays in the item's base_unit)
      purchase-orders/         — Purchase Order list, create, detail + GRN receiving
      inventory/               — Current stock (+ Reserved/Free), per-item ledger drill-down,
                                  stock adjustments
      stock-transfers/         — Stock Transfer list, create (warehouse-to-warehouse,
                                  no GL impact), detail, cancel
      jobs/                    — Job list, create (from a Fabrication SO line), detail —
                                  material requirements, reserve/issue/return, progress,
                                  ready-for-dispatch, cancel, cost summary
      product-templates/       — BOM/Product Template list, create, detail
      delivery-challans/       — DC list, create (from a Sales Order), detail —
                                  Client Acceptance/POD, dispute, cancel
      invoices/                — GST Invoice list, create (against delivered qty), detail —
                                  payment history, Sales Return panel, cancel
      sales-returns/           — Sales Return (credit note) list + [id]/ detail, cancel —
                                  created contextually from the Invoice detail page
      supplier-bills/          — Supplier Bill list, create (from a 'stock'-type GRN), detail —
                                  payment history, Purchase Return panel, cancel
      purchase-returns/        — Purchase Return (debit note) list + [id]/ detail, cancel —
                                  created contextually from the Supplier Bill detail page
      payments/                — Payment list, create (receipt or payment, bill-wise
                                  allocation, Cash/Bank/Petty-Cash source), detail — allocate
                                  remainder, cancel
      cash-bank/                — live Cash in Hand / Bank / Petty Cash position, per-account
                                  and per-fund balance breakdown
      expenses/                 — Expense list, create (head + payment source + optional
                                  Job/person/department link), detail, cancel
      transfers/                — Contra / fund transfer list, create (Cash↔Bank↔Petty-Cash,
                                  any combination), detail, cancel (Owner only)
      journal-vouchers/         — Manual Journal Voucher list, create (multi-line, live
                                  Debit=Credit balance check)
      reports/                 — Owner Dashboard: Today/Week/Month/Custom + All/Material
                                  Supply/Fabrication filters, 10 top KPI cards, 4 management
                                  charts (Queries/Quotations/PO trend, Material Supply vs
                                  Fabrication, Receivables vs Payables, Cash & Bank trend),
                                  operational mini-tables (Recent Queries/Quotations,
                                  Fabrication Jobs Status, Pending Deliveries, Payment
                                  Follow-ups), Owner control sections (Action Required — 9
                                  alert types, Order Health, Pending From Whom?, Daily Owner
                                  Summary) + daily-ledger/, ar-aging/(+export/),
                                  ap-aging/(+export/), trial-balance/(+export/), profit-loss/,
                                  balance-sheet/, cash-flow/, party-ledger/, general-ledger/,
                                  vehicle-expenses/, pending-orders/(+export/),
                                  purchase-pending/, grn-report/, payment-collection/
                                  (+export/), customer-business/(+export/), order-status/,
                                  order-health/ (Stage Aging dashboard), daily-snapshot/
                                  (stat tiles + 90-day history, pg_cron-generated daily),
                                  credit-limit-warning/, quotation-followups/,
                                  raw-material-shortage/ (new Action Required drill-downs)
      search/                  — Global Search across parties/queries/quotations/orders/
                                  jobs/deliveries/invoices/bills/items/vehicles
      tasks/                   — Tasks & Follow-ups: company-wide list (filters), new/
                                  (standalone create, optional entity link), [id]/
                                  (detail, edit, complete/reopen/cancel)
      setup/company/           — company profile
      setup/warehouses/        — warehouse management
      setup/bank-accounts/     — bank account master (+ opening balance)
      setup/petty-cash-funds/  — petty cash fund master (+ custodian, opening balance)
      setup/expense-heads/     — configurable expense categories (each auto-creates its
                                  own P&L account under 6000 Operating Expenses)
      setup/vehicles/          — fleet list + [id]/ detail (assign Engineer/Rider, status,
                                  meter reading, expense history, documents)
      setup/users/             — role assignment
      setup/chart-of-accounts/ — ledger accounts
      setup/import/            — CSV/Excel Import Wizard
      setup/period-lock/       — set/clear the accounting Period Lock date (Owner only)
      setup/permissions/       — configurable Permission Matrix — grant/restrict, per
                                  non-Owner role, which of the 19 core transactional
                                  actions that role may perform (Owner only; DB's own
                                  hardcoded role check on each action stays as an
                                  unchangeable floor the matrix can only narrow within)
      setup/backup-restore/    — upload a Daily Backup JSON, review a per-table
                                  add/update/delete plan, Merge or Replace, auto-downloaded
                                  safety snapshot + typed "RESTORE" confirmation before
                                  anything is touched, per-table result report (Owner only)
      not-found.tsx, error.tsx — branded 404 / error boundary inside the app shell
    actions/                   — Server Actions (auth, setup, import, queries, quotations,
                                  salesOrders, purchaseOrders, items, inventory, jobs,
                                  deliveryChallans, invoices, supplierBills, payments,
                                  cashBank, vehicles, parties, attachments, tasks, returns,
                                  stockTransfers, snapshots, permissions, backupRestore)
  components/                  — client-side form/UI components (incl. TasksPanel,
                                  TaskActionButtons, NewTaskForm, EditTaskForm,
                                  SalesReturnPanel, PurchaseReturnPanel,
                                  NewStockTransferForm, CancelStockTransferButton,
                                  PeriodLockForm, GenerateSnapshotButton,
                                  PermissionMatrixTable, TrendLineChart, CompareBarChart —
                                  the last two are the Owner Dashboard's own theme-aware
                                  inline-SVG/CSS charts, no charting library dependency —
                                  MobileNav — phone-width sidebar fallback (a sticky top bar
                                  + slide-in drawer, same nav/search/logout as the desktop
                                  sidebar), RestoreBackupPanel — the Backup & Restore UI,
                                  PaginationControls — shared Prev/Next + page-number links)
  lib/
    supabase/                  — browser + server Supabase clients, generated DB types
    auth.ts, roles.ts          — current-user/role helpers
    restoreTableOrder.ts       — the dependency-ordered table list shared by the Restore
                                  Server Actions and (duplicated, since it deliberately
                                  isn't part of this bundle) backup/backup.js
    permissionDefs.ts          — client-safe Permission Matrix constants (keys, labels,
                                  modules, each action's DB-hardcoded allowed roles) —
                                  mirrors the auth.ts/roles.ts client/server split
    permissions.ts             — server-only hasPermission()/loadPermissionMatrix(),
                                  re-exports the constants from permissionDefs.ts
    aging.ts (+ aging.test.ts) — AR/AP aging-bucket logic, shared by Customer 360 and
                                  the AR/AP Aging reports
    orderHealth.ts (+ .test.ts) — Order Health / Stage Aging logic (On Track/At Risk/
                                  Delayed/Stalled), shared by the SO/PO/Job list pages
                                  and the Order Health report
    dashboardHelpers.ts (+ .test.ts) — Owner Dashboard date-range resolution (Today/
                                  Week/Month/Custom) and daily/weekly trend-chart
                                  bucketing — pure logic, independently tested like the
                                  two libs above
    taskLinks.ts               — resolves a task's (related_table, related_id) to a link
                                  back to its owning entity's detail page
    printStyles.ts             — shared A4 print stylesheet + auto-print script, used by
                                  every [id]/print/ route above
    excelExport.ts             — shared xlsx builder (exceljs) backing every /export
                                  Route Handler above
    pagination.ts              — shared DEFAULT_PAGE_SIZE/parsePage/pageRange/totalPages
                                  helpers, used by every paginated list page
    smartMerge.ts (+ .test.ts) — Smart Merge client: diffFields() (pure) + smartMergeUpdate()
                                  (calls fn_smart_merge_update)
    offlineQueue.ts            — dependency-free IndexedDB-backed offline write queue,
                                  replays every entry through smartMergeUpdate()
  proxy.ts                     — session refresh + route protection (Next.js 16's
                                  renamed middleware.ts) — sw.js/manifest.webmanifest/
                                  offline.html are excluded from auth so the service
                                  worker always registers, signed in or not
  components/OfflineQueueProvider.tsx — offline/pending-sync status pill, sync toast,
                                  and Smart-Merge conflict-resolution banner for a
                                  background-synced write; wraps the (app) layout
  components/ServiceWorkerRegister.tsx — registers public/sw.js, shows an "update
                                  available" toast when a new version has installed
public/sw.js, manifest.webmanifest, offline.html, icon-*.png — the PWA shell:
                                  network-first HTML, stale-while-revalidate static
                                  assets, versioned cache, never caches API/RPC calls
backup/                        — standalone Daily Backup runner (backup.js + its own
                                  package.json) — deliberately NOT part of the Next.js
                                  app bundle; runs headless via GitHub Actions only
.github/workflows/
  daily-backup.yml             — schedules backup/backup.js daily + a manual-run button
```

Database migrations for this phase live in `supabase/migrations/` (applied
against the Supabase project via the Supabase CLI or MCP tooling — this
repo does not bundle the CLI itself). `src/lib/supabase/database.types.ts`
is generated from the live database schema.

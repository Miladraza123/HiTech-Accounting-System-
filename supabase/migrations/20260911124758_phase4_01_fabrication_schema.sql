-- BOM: a reusable "recipe" for a repeat product
create table public.product_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null unique,
  name text not null,
  description text,
  output_item_id uuid references public.items(id),
  output_unit text references public.units(code),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_pt_output_item on public.product_templates(output_item_id);
create index idx_pt_created_by on public.product_templates(created_by);

create table public.product_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  item_id uuid not null references public.items(id),
  qty_per_unit numeric(18,4) not null check (qty_per_unit > 0),
  unit text references public.units(code),
  sort_order int not null default 0
);
create index idx_ptl_template on public.product_template_lines(template_id);
create index idx_ptl_item on public.product_template_lines(item_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null unique,
  sales_order_id uuid not null references public.sales_orders(id),
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  product_template_id uuid references public.product_templates(id),
  warehouse_id uuid not null references public.warehouses(id),
  description text not null,
  job_qty numeric(18,3) not null check (job_qty > 0),
  responsible_user_id uuid references auth.users(id),
  start_date date,
  required_delivery_date date,
  status text not null default 'MaterialPending'
    check (status in ('MaterialPending','MaterialAvailable','FabricationStarted','InProcess','ReadyForDispatch','Delivered','Cancelled')),
  progress_pct int not null default 0 check (progress_pct between 0 and 100),
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  row_version bigint not null default 1
);
create index idx_jobs_so on public.jobs(sales_order_id);
create index idx_jobs_so_line on public.jobs(sales_order_line_id);
create index idx_jobs_warehouse on public.jobs(warehouse_id);
create index idx_jobs_template on public.jobs(product_template_id);
create index idx_jobs_status on public.jobs(status);
create index idx_jobs_responsible on public.jobs(responsible_user_id);
create index idx_jobs_created_by on public.jobs(created_by);
create index idx_jobs_updated_by on public.jobs(updated_by);

create table public.job_material_requirements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_id uuid not null references public.items(id),
  required_qty numeric(18,3) not null check (required_qty > 0),
  reserved_qty numeric(18,3) not null default 0,
  issued_qty numeric(18,3) not null default 0,
  returned_qty numeric(18,3) not null default 0,
  unit text references public.units(code),
  source text not null default 'manual' check (source in ('template','manual')),
  unique (job_id, item_id)
);
create index idx_jmr_job on public.job_material_requirements(job_id);
create index idx_jmr_item on public.job_material_requirements(item_id);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_id uuid not null references public.items(id),
  warehouse_id uuid not null references public.warehouses(id),
  reserved_qty numeric(18,3) not null check (reserved_qty > 0),
  reservation_mode text not null check (reservation_mode in ('auto','manual')),
  status text not null default 'Active' check (status in ('Active','Released','Consumed')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_sr_job on public.stock_reservations(job_id);
create index idx_sr_item_wh_status on public.stock_reservations(item_id, warehouse_id, status);
create index idx_sr_created_by on public.stock_reservations(created_by);

create table public.job_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  cost_type text not null check (cost_type in ('material','labour','overhead')),
  amount numeric(18,2) not null check (amount >= 0),
  qty numeric(18,3),
  item_id uuid references public.items(id),
  memo text,
  ref_table text,
  ref_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index idx_jcl_job on public.job_cost_ledger(job_id);
create index idx_jcl_item on public.job_cost_ledger(item_id);
create index idx_jcl_created_by on public.job_cost_ledger(created_by);

create trigger trg_updated_at before update on public.jobs for each row execute function public.fn_set_updated_at();
create trigger trg_audit after insert or update or delete on public.jobs for each row execute function public.fn_audit_row();
create trigger trg_audit after insert or update or delete on public.product_templates for each row execute function public.fn_audit_row();

-- Available / Reserved / Free stock, per §8 of the blueprint
create or replace view public.reserved_stock as
select item_id, warehouse_id, sum(reserved_qty) as reserved_qty
from public.stock_reservations
where status = 'Active'
group by item_id, warehouse_id;

grant select on public.reserved_stock to authenticated;

create or replace view public.stock_availability as
select
  cs.item_id,
  cs.warehouse_id,
  cs.qty_on_hand,
  coalesce(rs.reserved_qty, 0) as reserved_qty,
  cs.qty_on_hand - coalesce(rs.reserved_qty, 0) as free_qty,
  cs.avg_cost
from public.current_stock cs
left join public.reserved_stock rs on rs.item_id = cs.item_id and rs.warehouse_id = cs.warehouse_id;

grant select on public.stock_availability to authenticated;

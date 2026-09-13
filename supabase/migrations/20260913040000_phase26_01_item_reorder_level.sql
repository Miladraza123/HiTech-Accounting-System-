-- Phase 26: in-app notifications need a per-item "low stock" threshold
-- that doesn't exist anywhere yet. Nullable and opt-in on purpose: null
-- (the default for every existing item) means "don't alert for this
-- item" rather than silently alerting on a guessed default the moment
-- this ships — an Owner/Store user sets it deliberately per item that
-- actually needs reordering.
alter table public.items
  add column reorder_level numeric;

comment on column public.items.reorder_level is
  'Optional low-stock alert threshold (total qty on hand, summed across warehouses). Null = no low-stock alert for this item.';

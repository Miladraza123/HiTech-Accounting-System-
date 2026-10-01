-- Phase 37 — "Close PO" for a short-received Purchase Order.
--
-- 'Closed' was already a valid purchase_orders.status (in the CHECK
-- constraint, and already excluded from fn_purchase_pending / the Owner
-- Dashboard's open-PO aggregates) but nothing ever actually set it — a PO
-- that received less than ordered (e.g. natural weight tolerance on raw
-- material: 2000kg ordered, 1998kg actually received) had no way to be
-- marked done, so it sat at 'PartiallyReceived' and kept showing up in the
-- Purchase Pending Report forever, as if the missing qty was still coming.
--
-- Mirrors fn_cancel_purchase_order's shape exactly (same role gate, same
-- "reason required" rule, reuses the same cancel_reason column — both are
-- "why this PO didn't complete the normal way"). Deliberately only from
-- 'PartiallyReceived': a PO with zero receiving belongs to Cancel, not
-- Close, and one already 'Received'/'Closed'/'Cancelled' has nothing to
-- close.

create or replace function public.fn_close_purchase_order(p_purchase_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_role('store')) then
    raise exception 'Only Owner or Store can close a Purchase Order.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to close a Purchase Order.';
  end if;

  update public.purchase_orders
    set status = 'Closed', cancel_reason = p_reason
    where id = p_purchase_order_id and status = 'PartiallyReceived';

  if not found then
    raise exception 'This Purchase Order cannot be closed — it must be Partially Received.';
  end if;
end;
$$;

revoke execute on function public.fn_close_purchase_order(uuid, text) from public, anon;
grant execute on function public.fn_close_purchase_order(uuid, text) to authenticated;

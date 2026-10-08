"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { diffFields, smartMergeUpdate, type SmartMergeConflict } from "@/lib/smartMerge";

export type ActionResult = { error: string | null; success?: boolean; conflicts?: SmartMergeConflict[]; warning?: string };

export async function createItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();

  const item_code = String(formData.get("item_code") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const base_unit = String(formData.get("base_unit") ?? "");
  if (!item_code || !description || !base_unit) {
    return { error: "Item code, description, and unit are required." };
  }

  const reorderLevelRaw = String(formData.get("reorder_level") ?? "").trim();
  const standardCost = Number(formData.get("standard_cost") ?? 0);

  const { data: item, error } = await supabase
    .from("items")
    .insert({
      item_code,
      description,
      base_unit,
      category: String(formData.get("category") ?? "").trim() || null,
      spec: String(formData.get("spec") ?? "").trim() || null,
      hs_code: String(formData.get("hs_code") ?? "").trim() || null,
      tax_category: String(formData.get("tax_category") ?? "standard"),
      is_stocked: formData.get("is_stocked") === "on",
      standard_cost: standardCost,
      reorder_level: reorderLevelRaw ? Number(reorderLevelRaw) : null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Optional Opening Stock at creation — the same fn_import_opening_stock
  // RPC the Import Wizard already uses (posts the stock_ledger row + its
  // offsetting journal entry), called directly here so this doesn't need a
  // separate trip through Setup → Import. The item is already created at
  // this point, so a failure here (e.g. no warehouse picked, or the creator
  // isn't Owner/Accounts, which the RPC itself enforces) is reported as a
  // warning rather than undoing the item.
  const openingQty = Number(formData.get("opening_stock_qty") ?? 0);
  const openingWarehouseId = String(formData.get("opening_stock_warehouse_id") ?? "").trim();
  if (openingQty > 0) {
    if (!openingWarehouseId) {
      revalidatePath("/items");
      return { error: null, success: true, warning: "Opening Stock needs a warehouse — not posted. You can add it later from Setup → Import." };
    }
    const { data: warehouse } = await supabase.from("warehouses").select("code").eq("id", openingWarehouseId).maybeSingle();
    const openingRateRaw = String(formData.get("opening_stock_rate") ?? "").trim();
    const { error: stockError } = await supabase.rpc("fn_import_opening_stock", {
      p_item_code: item_code,
      p_warehouse_code: warehouse?.code ?? "",
      p_qty: openingQty,
      p_rate: openingRateRaw ? Number(openingRateRaw) : standardCost,
      p_as_of_date: new Date().toISOString().slice(0, 10),
      p_ref_table: "items",
      p_ref_id: item.id,
      p_notes: `Opening stock — ${item_code}`,
    });
    if (stockError) {
      revalidatePath("/items");
      return { error: null, success: true, warning: `Opening Stock could not be posted: ${stockError.message}` };
    }
  }

  revalidatePath("/items");
  return { error: null, success: true };
}

// Minimal Item creation for the GRN "Add New Item" inline flow (Phase
// 46.03) — just enough to receive stock against it. Everything else
// (category, spec, HS code, costing, opening stock) stays the Items page's
// own job, editable there afterwards.
export async function quickCreateItemAction(input: {
  item_code: string;
  description: string;
  base_unit: string;
}): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient();

  const item_code = input.item_code.trim();
  const description = input.description.trim();
  if (!item_code || !description || !input.base_unit) {
    return { error: "Item code, description, and unit are required." };
  }

  const { data: item, error } = await supabase
    .from("items")
    .insert({ item_code, description, base_unit: input.base_unit })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/items");
  return { error: null, id: item.id };
}

export type ItemEditableFields = {
  item_code: string;
  description: string;
  category: string | null;
  spec: string | null;
  base_unit: string;
  hs_code: string | null;
  tax_category: string;
  is_stocked: boolean;
  standard_cost: number;
};

// Every Item Master field except reorder_level (its own dedicated inline
// field, unchanged) and is_active (its own toggle, unchanged) now goes
// through the same generic Smart Merge engine as Company/Party/Warehouse/
// Vehicle instead of having no edit path at all — a genuine field-level
// 3-way merge, so two people editing different fields of the same item at
// once never lose either change.
export async function updateItemAction(
  id: string,
  base: ItemEditableFields,
  next: ItemEditableFields
): Promise<ActionResult> {
  const supabase = await createClient();
  const changes = diffFields(base, next);

  // Once stock has moved, every stock_ledger row's qty/avg_cost is in the old
  // base_unit, and is_stocked decides whether the ledger applies at all —
  // changing either would silently reinterpret the item's whole history.
  if ("base_unit" in changes || "is_stocked" in changes) {
    const { count, error: ledgerError } = await supabase
      .from("stock_ledger")
      .select("id", { count: "exact", head: true })
      .eq("item_id", id);
    if (ledgerError) return { error: ledgerError.message };
    if ((count ?? 0) > 0) {
      return {
        error:
          "This item already has stock movements, so its unit and \"stocked\" setting can't be changed. Create a new item instead (and deactivate this one).",
      };
    }
  }

  const { result, error } = await smartMergeUpdate(supabase, "items", id, base, changes);
  if (error) return { error: error.message };
  if (result && result.conflicts.length > 0) {
    return { error: null, conflicts: result.conflicts };
  }

  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  return { error: null, success: true };
}

export async function toggleItemActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  if (!isOwner(await getCurrentUser())) return { error: "Only Owner can activate/deactivate an item." };
  const supabase = await createClient();
  // `.select("id")` so an RLS-filtered no-op update reports instead of looking like a success.
  const { data, error } = await supabase.from("items").update({ is_active: isActive }).eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You don't have permission to perform this action." };
  revalidatePath("/items");
  return { error: null, success: true };
}

// Owner-only, and only once fn_delete_master_row confirms nothing already
// references this item (stock movements, document lines, etc.) — the
// Items list falls back to Deactivate for anything still in use.
export async function deleteItemAction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_delete_master_row", { p_table: "items", p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/items");
  return { error: null, success: true };
}

// Low-stock notifications only fire for an item once someone deliberately
// sets a reorder level for it — null (every item's default) means "don't
// alert". Editable any time from the item's own detail page, not just at
// creation, since most items already exist.
export async function updateItemReorderLevelAction(id: string, reorderLevel: number | null): Promise<ActionResult> {
  if (reorderLevel !== null && reorderLevel < 0) return { error: "Reorder level can't be negative." };

  const supabase = await createClient();
  const { error } = await supabase.from("items").update({ reorder_level: reorderLevel }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/items/${id}`);
  return { error: null, success: true };
}

// --- Item Alternate Units (multi-unit conversion) — Sale/Issue/Delivery side only.
// Purchase/GRN always stays in items.base_unit, unaffected by this table.

export async function addItemAltUnitAction(itemId: string, unit: string, factor: number): Promise<ActionResult> {
  const supabase = await createClient();
  if (!unit) return { error: "Select a unit." };
  if (!factor || factor <= 0) return { error: "Factor must be greater than zero." };

  const { error } = await supabase.from("item_alt_units").insert({ item_id: itemId, unit, factor });
  if (error) return { error: error.message };
  revalidatePath(`/items/${itemId}`);
  return { error: null, success: true };
}

export async function toggleItemAltUnitActiveAction(id: string, itemId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("item_alt_units").update({ is_active: isActive }).eq("id", id);
  revalidatePath(`/items/${itemId}`);
  return { error: error?.message ?? null };
}

export async function deleteItemAltUnitAction(id: string, itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  // RLS (Owner-only delete) filters the row out instead of raising, so an
  // unauthorized delete would otherwise look like a success.
  const { data, error } = await supabase.from("item_alt_units").delete().eq("id", id).select("id");
  revalidatePath(`/items/${itemId}`);
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the Owner can remove an alternate unit — deactivate it instead." };
  return { error: null };
}

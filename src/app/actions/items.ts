"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string | null; success?: boolean };

export async function createItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();

  const item_code = String(formData.get("item_code") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const base_unit = String(formData.get("base_unit") ?? "");
  if (!item_code || !description || !base_unit) {
    return { error: "Item code, description, and unit are required." };
  }

  const reorderLevelRaw = String(formData.get("reorder_level") ?? "").trim();

  const { error } = await supabase.from("items").insert({
    item_code,
    description,
    base_unit,
    category: String(formData.get("category") ?? "").trim() || null,
    spec: String(formData.get("spec") ?? "").trim() || null,
    hs_code: String(formData.get("hs_code") ?? "").trim() || null,
    tax_category: String(formData.get("tax_category") ?? "standard"),
    is_stocked: formData.get("is_stocked") === "on",
    standard_cost: Number(formData.get("standard_cost") ?? 0),
    reorder_level: reorderLevelRaw ? Number(reorderLevelRaw) : null,
  });

  if (error) return { error: error.message };
  revalidatePath("/items");
  return { error: null, success: true };
}

export async function toggleItemActiveAction(id: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("items").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/items");
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
  const { error } = await supabase.from("item_alt_units").delete().eq("id", id);
  revalidatePath(`/items/${itemId}`);
  return { error: error?.message ?? null };
}

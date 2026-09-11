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
    return { error: "Item code, description aur unit zaroori hain." };
  }

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

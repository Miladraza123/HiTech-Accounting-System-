import type { createClient } from "@/lib/supabase/server";
import type { LineItem } from "@/components/QuotationLineEditor";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Exactly the item columns a line editor reads — see LineItem. The embedded
 * item_alt_units ride along, so every item a page hands down already carries
 * its own unit conversions and the page never has to load the whole
 * item_alt_units table to find them.
 */
export const ITEM_PICKER_COLUMNS =
  "id, item_code, description, base_unit, standard_cost, item_alt_units(item_id, unit, factor, is_active)";

/** How many items a page ships up front before the user has typed anything. */
export const ITEM_PAGE_SIZE = 20;

/**
 * The item rows a line-editor page needs to render without asking the
 * browser to hold the whole catalogue.
 *
 * That is a first page of active items, plus every item already referenced
 * by the document being edited — so an existing line still shows its own
 * item code and resolves its own base unit even when that item sits far
 * outside the first page. Everything else is found by typing, which
 * searches in the database (see SearchablePicker).
 *
 * The referenced lookup is deliberately NOT filtered by `is_active`: a line
 * already saved against an item that has since been deactivated must keep
 * showing that item, exactly as it did when the page sent every row.
 */
export async function fetchLineItems(
  supabase: ServerClient,
  referencedIds: (string | null | undefined)[] = []
): Promise<LineItem[]> {
  const ids = [...new Set(referencedIds.filter((v): v is string => !!v))];

  const [{ data: firstPage }, { data: referenced }] = await Promise.all([
    supabase.from("items").select(ITEM_PICKER_COLUMNS).eq("is_active", true).order("item_code").limit(ITEM_PAGE_SIZE),
    ids.length
      ? supabase.from("items").select(ITEM_PICKER_COLUMNS).in("id", ids)
      : Promise.resolve({ data: [] as LineItem[] }),
  ]);

  const byId = new Map<string, LineItem>();
  for (const row of [...(firstPage ?? []), ...(referenced ?? [])]) byId.set(row.id, row as LineItem);
  return [...byId.values()].sort((a, b) => a.item_code.localeCompare(b.item_code));
}

/**
 * Just the items named by the given ids — for a screen that never offers an
 * item dropdown at all and only needs to resolve the items its own document
 * lines already reference (Delivery Challan reads each one's `base_unit` to
 * convert a delivered qty into base units before it reaches the stock
 * ledger). Deliberately unfiltered by `is_active`, for the same reason
 * fetchLineItems' referenced lookup is: a line saved against an item that
 * has since been deactivated must still resolve.
 */
export async function fetchItemsByIds(
  supabase: ServerClient,
  referencedIds: (string | null | undefined)[]
): Promise<LineItem[]> {
  const ids = [...new Set(referencedIds.filter((v): v is string => !!v))];
  if (!ids.length) return [];
  const { data } = await supabase.from("items").select(ITEM_PICKER_COLUMNS).in("id", ids);
  return (data ?? []) as LineItem[];
}

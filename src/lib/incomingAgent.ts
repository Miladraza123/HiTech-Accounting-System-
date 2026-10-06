// Parsing and sanitising of the optional structured fields that the external
// Email Agent adds to the /api/inbound-email webhook (Phase 44).
//
// The webhook is a trust boundary: everything coming in is whitelisted,
// length-capped and type-checked here before it reaches the database. Anything
// unexpected is dropped rather than stored. The agent only ever *adds* data —
// approving, rejecting or converting a document stays with this app's own flow.

export const AGENT_DOC_TYPES = ["RFQ", "PR", "PO", "Invoice", "Other"] as const;
export type AgentDocType = (typeof AGENT_DOC_TYPES)[number];

export type AgentItem = {
  description?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  amount?: number;
};

export type AgentData = {
  party_name?: string;
  party_role?: string;
  reference_no?: string;
  document_date?: string;
  due_date?: string;
  currency?: string;
  total_amount?: number;
  tax_amount?: number;
  payment_terms?: string;
  items?: AgentItem[];
  notes?: string;
  missing_fields?: string[];
  confidence?: number;
  reasoning?: string;
};

export type AgentFields = {
  messageId: string;
  docType: AgentDocType | null;
  data: AgentData | null;
  needsReview: boolean;
  senderName: string | null;
  senderEmail: string | null;
};

const MAX_DATA_CHARS = 200_000;
const MAX_ITEMS = 200;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_RE.test(value);
}

/**
 * Pulls a bare, lower-cased address out of a mail header value such as
 * `"ACME <PO@acme.com>"` or `po@acme.com`. Returns null if there is none.
 */
export function extractEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/<([^<>]+)>\s*$/);
  const candidate = (angle ? angle[1] : trimmed).trim().toLowerCase();
  return isValidEmail(candidate) ? candidate : null;
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function sanitizeItem(raw: unknown): AgentItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const item: AgentItem = {};
  const description = str(r.description, 500);
  const unit = str(r.unit, 30);
  const quantity = num(r.quantity);
  const unitPrice = num(r.unit_price);
  const amount = num(r.amount);
  if (description !== undefined) item.description = description;
  if (unit !== undefined) item.unit = unit;
  if (quantity !== undefined) item.quantity = quantity;
  if (unitPrice !== undefined) item.unit_price = unitPrice;
  if (amount !== undefined) item.amount = amount;
  return Object.keys(item).length ? item : null;
}

/** Rebuilds an AgentData object from only the known keys; returns null if nothing usable. */
export function sanitizeAgentData(raw: unknown): AgentData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: AgentData = {};

  const strings: [keyof AgentData, number][] = [
    ["party_name", 300],
    ["party_role", 50],
    ["reference_no", 100],
    ["document_date", 30],
    ["due_date", 30],
    ["currency", 10],
    ["payment_terms", 300],
    ["notes", 2000],
    ["reasoning", 500],
  ];
  for (const [key, max] of strings) {
    const v = str(r[key], max);
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  for (const key of ["total_amount", "tax_amount", "confidence"] as const) {
    const v = num(r[key]);
    if (v !== undefined) out[key] = v;
  }
  if (Array.isArray(r.items)) {
    const items = r.items.slice(0, MAX_ITEMS).map(sanitizeItem).filter((i): i is AgentItem => i !== null);
    if (items.length) out.items = items;
  }
  if (Array.isArray(r.missing_fields)) {
    const missing = r.missing_fields
      .slice(0, 30)
      .map((m) => str(m, 60))
      .filter((m): m is string => m !== undefined);
    if (missing.length) out.missing_fields = missing;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Reads the optional `agent_*` form fields. Returns null when `agent_message_id`
 * is missing — i.e. for a regular Mailgun delivery, which must behave exactly as
 * it did before Phase 44.
 */
export function parseAgentFields(form: FormData): AgentFields | null {
  const messageId = str(form.get("agent_message_id"), 300);
  if (!messageId) return null;

  const rawType = str(form.get("agent_doc_type"), 20);
  const docType = rawType && (AGENT_DOC_TYPES as readonly string[]).includes(rawType) ? (rawType as AgentDocType) : null;

  let data: AgentData | null = null;
  const rawData = form.get("agent_data");
  if (typeof rawData === "string" && rawData.length <= MAX_DATA_CHARS) {
    try {
      data = sanitizeAgentData(JSON.parse(rawData));
    } catch {
      data = null;
    }
  }

  const rawReview = str(form.get("agent_needs_review"), 10)?.toLowerCase();
  const needsReview = rawReview === "true" || rawReview === "1";

  const senderName = str(form.get("agent_sender_name"), 200) ?? null;
  const email = str(form.get("agent_sender_email"), 320)?.toLowerCase();
  const senderEmail = email && isValidEmail(email) ? email : null;

  return { messageId, docType, data, needsReview, senderName, senderEmail };
}

/**
 * Plain-text list of the requested items, used to pre-fill a Query's "Requirement"
 * from an Email Agent document — just the item lines, no party/date/count/prices,
 * e.g. "1. MS Plate 25mm - 1 pc". Returns null when there are no usable items so the
 * caller can fall back to the email body.
 */
export function requirementFromAgentData(raw: unknown): string | null {
  const items = sanitizeAgentData(raw)?.items ?? [];
  const lines = items
    .filter((it) => it.description)
    .map((it) => {
      const qty = it.quantity !== undefined ? `${it.quantity}${it.unit ? ` ${it.unit}` : ""}` : "";
      return qty ? `${it.description} - ${qty}` : (it.description as string);
    });
  if (!lines.length) return null;
  return lines.length === 1 ? lines[0] : lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

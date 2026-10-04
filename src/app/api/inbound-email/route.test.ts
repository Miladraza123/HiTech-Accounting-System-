import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A tiny in-memory stand-in for the Supabase admin client — just enough of the
// query-builder surface that the webhook route uses.
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  docs: [] as Row[],
  attachments: [] as Row[],
  trusted: [] as string[],
  inserts: [] as Row[],
  raceOnNextInsert: false,
  lookupCalls: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let pendingInsert: Row | null = null;
      const q = {
        select() {
          return q;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return q;
        },
        async maybeSingle() {
          if (table === "incoming_documents") {
            state.lookupCalls++;
            const found = state.docs.find((d) => d.agent_message_id === filters.agent_message_id);
            return { data: found ? { id: found.id } : null, error: null };
          }
          if (table === "trusted_senders") {
            return { data: state.trusted.includes(String(filters.email)) ? { email: filters.email } : null, error: null };
          }
          return { data: null, error: null };
        },
        insert(row: Row) {
          if (table === "incoming_document_attachments") {
            state.attachments.push(row);
            return Promise.resolve({ error: null });
          }
          pendingInsert = row;
          return q;
        },
        async single() {
          const row = pendingInsert as Row;
          if (state.raceOnNextInsert) {
            state.raceOnNextInsert = false;
            state.docs.push({ id: "winner-id", agent_message_id: row.agent_message_id });
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          state.inserts.push(row);
          const id = `doc-${state.inserts.length}`;
          state.docs.push({ id, ...row });
          return { data: { id }, error: null };
        },
      };
      return q;
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));

import { POST } from "./route";

function post(fields: Record<string, string | File>, token = "secret") {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new NextRequest(`http://localhost/api/inbound-email?token=${token}`, { method: "POST", body: f });
}

beforeEach(() => {
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "secret";
  delete process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  state.docs = [];
  state.attachments = [];
  state.trusted = [];
  state.inserts = [];
  state.raceOnNextInsert = false;
  state.lookupCalls = 0;
});

describe("POST /api/inbound-email", () => {
  it("rejects a wrong token and writes nothing", async () => {
    const res = await POST(post({ sender: "a@b.com" }, "wrong"));
    expect(res.status).toBe(401);
    expect(state.inserts).toHaveLength(0);
  });

  it("keeps the plain Mailgun flow exactly as before (no agent columns written)", async () => {
    const res = await POST(post({ sender: "a@b.com", subject: "RFQ", "body-plain": "hello" }));
    expect(res.status).toBe(200);
    expect(state.inserts).toEqual([{ source: "email", from_address: "a@b.com", subject: "RFQ", body_text: "hello" }]);
    expect(state.lookupCalls).toBe(0);
  });

  it("stores agent fields and flags an unknown sender as untrusted", async () => {
    const res = await POST(
      post({
        sender: "ACME <PO@acme.com>",
        subject: "PO 55",
        "body-plain": "body",
        agent_message_id: "c1:<m1>",
        agent_doc_type: "PO",
        agent_needs_review: "true",
        agent_sender_name: "ACME",
        agent_sender_email: "PO@Acme.com",
        agent_data: JSON.stringify({ party_name: "ACME", total_amount: 900, evil: "x" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.inserts[0]).toMatchObject({
      agent_message_id: "c1:<m1>",
      sender_name: "ACME",
      sender_email: "po@acme.com",
      doc_type: "PO",
      ai_needs_review: true,
      sender_trust: "untrusted",
      ai_data: { party_name: "ACME", total_amount: 900 },
    });
    expect(state.inserts[0].ai_data).not.toHaveProperty("evil");
  });

  it("marks a previously trusted sender as trusted", async () => {
    state.trusted = ["po@acme.com"];
    await POST(post({ sender: "x", agent_message_id: "m2", agent_sender_email: "po@acme.com" }));
    expect(state.inserts[0].sender_trust).toBe("trusted");
  });

  it("is idempotent: a repeated agent_message_id returns the existing row", async () => {
    await POST(post({ sender: "x", agent_message_id: "m3" }));
    const res = await POST(post({ sender: "x", agent_message_id: "m3" }));
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true, id: "doc-1" });
    expect(state.inserts).toHaveLength(1);
  });

  it("handles two simultaneous deliveries (unique-index race) without an error", async () => {
    state.raceOnNextInsert = true;
    const res = await POST(post({ sender: "x", agent_message_id: "m4" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true, id: "winner-id" });
  });

  it("still saves attachments for agent deliveries", async () => {
    const file = new File(["data"], "po.pdf", { type: "application/pdf" });
    await POST(post({ sender: "x", agent_message_id: "m5", "attachment-count": "1", "attachment-1": file }));
    expect(state.attachments).toHaveLength(1);
    expect(state.attachments[0]).toMatchObject({ file_name: "po.pdf", content_type: "application/pdf" });
  });
});

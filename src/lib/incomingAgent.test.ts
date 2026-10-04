import { describe, expect, it } from "vitest";
import { isValidEmail, parseAgentFields, requirementFromAgentData, sanitizeAgentData } from "./incomingAgent";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("parseAgentFields", () => {
  it("returns null for a regular Mailgun delivery (no agent_message_id)", () => {
    expect(parseAgentFields(form({ sender: "a@b.com", subject: "x", "body-plain": "y" }))).toBeNull();
  });

  it("parses a full agent delivery", () => {
    const r = parseAgentFields(
      form({
        agent_message_id: "client1:<abc@mail>",
        agent_doc_type: "PO",
        agent_needs_review: "true",
        agent_sender_name: "ACME Ltd",
        agent_sender_email: "  PO@ACME.com ",
        agent_data: JSON.stringify({ party_name: "ACME", total_amount: 900, items: [{ description: "Bolt", quantity: 10 }] }),
      }),
    );
    expect(r).toEqual({
      messageId: "client1:<abc@mail>",
      docType: "PO",
      needsReview: true,
      senderName: "ACME Ltd",
      senderEmail: "po@acme.com",
      data: { party_name: "ACME", total_amount: 900, items: [{ description: "Bolt", quantity: 10 }] },
    });
  });

  it("drops an unknown doc type, a bad email and broken JSON instead of storing them", () => {
    const r = parseAgentFields(
      form({ agent_message_id: "m1", agent_doc_type: "Spam", agent_sender_email: "not-an-email", agent_data: "{broken" }),
    );
    expect(r).toEqual({ messageId: "m1", docType: null, needsReview: false, senderName: null, senderEmail: null, data: null });
  });

  it("ignores oversized agent_data", () => {
    const r = parseAgentFields(form({ agent_message_id: "m1", agent_data: JSON.stringify({ notes: "x".repeat(250_000) }) }));
    expect(r?.data).toBeNull();
  });
});

describe("sanitizeAgentData", () => {
  it("keeps only known keys and correct types", () => {
    const d = sanitizeAgentData({
      party_name: "  ACME  ",
      total_amount: "900", // wrong type -> dropped
      tax_amount: 160,
      evil: "<script>alert(1)</script>",
      items: [{ description: "Bolt", quantity: 5, unit_price: Number.NaN, hack: 1 }, "junk", {}],
      missing_fields: ["due_date", 5, ""],
    });
    expect(d).toEqual({
      party_name: "ACME",
      tax_amount: 160,
      items: [{ description: "Bolt", quantity: 5 }],
      missing_fields: ["due_date"],
    });
  });

  it("caps items and string lengths", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ description: `item ${i}` }));
    const d = sanitizeAgentData({ items, notes: "n".repeat(5000) });
    expect(d?.items).toHaveLength(200);
    expect(d?.notes).toHaveLength(2000);
  });

  it("returns null for non-objects or when nothing is usable", () => {
    expect(sanitizeAgentData(null)).toBeNull();
    expect(sanitizeAgentData([1, 2])).toBeNull();
    expect(sanitizeAgentData({ evil: 1 })).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts normal addresses and rejects junk", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("Name <a@b.co>")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("nodomain@")).toBe(false);
  });
});

describe("requirementFromAgentData", () => {
  it("lists only the items: numbered, with quantity and unit, no party/date/count/prices", () => {
    const r = requirementFromAgentData({
      party_name: "ACME",
      document_date: "2026-10-04",
      total_amount: 900,
      items: [
        { description: "MS Plate 25mm 2000mm x 6000mm", quantity: 1, unit: "pc", unit_price: 50, amount: 50 },
        { description: "MS Girder 12x5, 12 meter lengths", quantity: 10, unit: "pc" },
      ],
    });
    expect(r).toBe("1. MS Plate 25mm 2000mm x 6000mm - 1 pc\n2. MS Girder 12x5, 12 meter lengths - 10 pc");
  });

  it("does not number a single item and omits a missing quantity", () => {
    expect(requirementFromAgentData({ items: [{ description: "MS Girder 10x10", quantity: 25, unit: "pc" }] })).toBe("MS Girder 10x10 - 25 pc");
    expect(requirementFromAgentData({ items: [{ description: "Binding wire" }] })).toBe("Binding wire");
  });

  it("returns null (so the email body is used) when there are no usable items", () => {
    expect(requirementFromAgentData(null)).toBeNull();
    expect(requirementFromAgentData({ party_name: "ACME" })).toBeNull();
    expect(requirementFromAgentData({ items: [{ quantity: 3 }] })).toBeNull();
    expect(requirementFromAgentData("junk")).toBeNull();
  });
});

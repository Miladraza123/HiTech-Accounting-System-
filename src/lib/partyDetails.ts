// Pure helpers for the client/supplier details form (no server-only imports, so client components can use them).

export type PartyDetails = {
  legal_name: string;
  ntn: string;
  strn: string;
  cnic: string;
  billing_address: string;
  province: string;
};

export const PARTY_DETAIL_LABEL: Record<keyof PartyDetails, string> = {
  legal_name: "Name",
  ntn: "NTN",
  strn: "STRN",
  cnic: "CNIC",
  billing_address: "Address",
  province: "Province",
};

/** Form strings → what is saved: trimmed, and blank optional fields become null. The name stays required. */
export function normalizePartyDetails(d: PartyDetails): { legal_name: string; ntn: string | null; strn: string | null; cnic: string | null; billing_address: string | null; province: string | null } {
  const opt = (v: string) => v.trim() || null;
  return {
    legal_name: d.legal_name.trim(),
    ntn: opt(d.ntn),
    strn: opt(d.strn),
    cnic: opt(d.cnic),
    billing_address: opt(d.billing_address),
    province: opt(d.province),
  };
}

/** Collapses stored nulls to "" for form inputs. */
export function toFormDetails(p: { legal_name: string; ntn: string | null; strn: string | null; cnic: string | null; billing_address: string | null; province: string | null }): PartyDetails {
  return {
    legal_name: p.legal_name,
    ntn: p.ntn ?? "",
    strn: p.strn ?? "",
    cnic: p.cnic ?? "",
    billing_address: p.billing_address ?? "",
    province: p.province ?? "",
  };
}

export type PartyContactInput = {
  name: string;
  designation: string;
  phone: string;
  email: string;
  is_primary: boolean;
};

export const EMPTY_CONTACT: PartyContactInput = { name: "", designation: "", phone: "", email: "", is_primary: false };

/** Same shape check the database applies to a contact's email (empty is fine). */
export function isPlausibleEmail(email: string): boolean {
  const t = email.trim();
  return t === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
}

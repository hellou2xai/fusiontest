import { fetchAllPages } from "../fusionClient.js";

export interface AgreementPriceLine {
  AgreementLineId: number;
  AgreementHeaderId: number;
  AgreementNumber: string;
  ItemId: number | null;
  Item: string | null;
  Description: string | null;
  Supplier: string;
  CategoryCode: string | null;
  Category: string | null;
  UOMCode: string;
  Price: number;
  CurrencyCode: string;
  Status: string;
  NegotiatedFlag: boolean;
}

/**
 * Fetches all open lines from Oracle Fusion Procurement's negotiated agreements
 * (Blanket Purchase Agreements + Contract Purchase Agreements), via the flat
 * top-level purchaseAgreementLines resource — this is the real, authoritative
 * negotiated-rate source Fusion itself provides, as opposed to the Excel
 * reference file's internally-derived fallback. One bulk paginated fetch, no
 * per-PO N+1 calls needed since the resource isn't nested under an agreement.
 */
export async function fetchOpenAgreementLines(): Promise<AgreementPriceLine[]> {
  return fetchAllPages<AgreementPriceLine>("purchaseAgreementLines", { q: "Status=Open" });
}

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

const CACHE_TTL_MS = 10 * 60 * 1000; // agreement data changes far less often than PO data
let cache: { fetchedAt: number; lines: AgreementPriceLine[] } | null = null;

/**
 * Fetches all open lines from Oracle Fusion Procurement's negotiated agreements
 * (Blanket Purchase Agreements + Contract Purchase Agreements), via the flat
 * top-level purchaseAgreementLines resource — this is the real, authoritative
 * negotiated-rate source Fusion itself provides, as opposed to the Excel
 * reference file's internally-derived fallback. One bulk paginated fetch, no
 * per-PO N+1 calls needed since the resource isn't nested under an agreement.
 *
 * This is identical on every call regardless of the analysis window, and on
 * this tenant alone takes 60-80s to fetch fresh (~5,000 lines, 25 pages of
 * sequential offset pagination) — cached in-memory so repeated dashboard
 * refreshes/window changes don't pay that cost every time.
 */
export async function fetchOpenAgreementLines(): Promise<AgreementPriceLine[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.lines;
  }
  const lines = await fetchAllPages<AgreementPriceLine>("purchaseAgreementLines", { q: "Status=Open" }, 500);
  cache = { fetchedAt: Date.now(), lines };
  return lines;
}

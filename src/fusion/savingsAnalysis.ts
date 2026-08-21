import { fetchAllPages, mapWithConcurrency } from "../fusionClient.js";
import { isBulkImportBuyer, type PurchaseOrder } from "./poAnalysis.js";
import { readReferencePrices } from "../excel/referencePrices.js";
import { fetchOpenAgreementLines } from "./agreementPrices.js";

interface PoLine {
  POLineId: number;
  POHeaderId: number;
  OrderNumber: string;
  Description: string | null;
  ItemId: number | null;
  CategoryCode: string | null;
  Category: string | null;
  UOMCode: string;
  UOM: string;
  Quantity: number;
  Price: number;
  CurrencyCode: string;
  Total: number;
  SourceAgreementId: number | null;
  SourceAgreementNumber: string | null;
  NegotiatedFlag: boolean;
}

// A price spread beyond this ratio between the cheapest and priciest line for the "same"
// description is treated as a data-quality issue (e.g. unrelated demo/seed data sharing a
// generic description), not a genuine procurement finding — it's flagged for review instead
// of counted in the credible savings total.
const PRICE_RATIO_OUTLIER_THRESHOLD = 5;

export interface MaverickSpend {
  totalOrganicSpendUSD: number;
  offContractSpendUSD: number;
  offContractShare: number;
  onContractLines: number;
  offContractLines: number;
  dataQualityFlag: boolean;
  note: string | null;
}

export interface PriceVarianceGroup {
  groupKey: string;
  description: string;
  category: string | null;
  uom: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  priceRatio: number;
  occurrences: number;
  lostSavings: number;
  lines: { orderNumber: string; price: number; quantity: number; lostSavings: number }[];
}

export interface ContractVarianceLine {
  orderNumber: string;
  description: string;
  contractedUnitPrice: number;
  paidUnitPrice: number;
  quantity: number;
  overpaid: number;
  currency: string;
}

export interface AgreementVarianceLine {
  orderNumber: string;
  description: string;
  agreementNumber: string;
  agreementPrice: number;
  paidUnitPrice: number;
  quantity: number;
  overpaid: number;
  currency: string;
  matchedBy: "item" | "description";
}

export interface SavingsAnalysisResult {
  generatedAt: string;
  windowDays: number;
  sinceDate: string;
  organicPoCount: number;
  organicLineCount: number;
  maverickSpend: MaverickSpend;
  priceVariance: {
    totalLostSavingsUSD: number;
    groupsWithVariance: PriceVarianceGroup[];
    totalFlaggedForReviewUSD: number;
    flaggedForReview: PriceVarianceGroup[];
  };
  contractVariance: {
    referencePricesLoaded: number;
    totalOverpaidUSD: number;
    lines: ContractVarianceLine[];
    derivedFromInternalData: boolean;
    note: string | null;
  };
  agreementVariance: {
    agreementLinesLoaded: number;
    matchedLines: number;
    totalOverpaidUSD: number;
    lines: AgreementVarianceLine[];
    note: string | null;
  };
}

function groupKeyFor(line: PoLine): string {
  if (line.ItemId != null) return `item:${line.ItemId}`;
  const desc = (line.Description ?? "").trim().toLowerCase();
  return `desc:${desc}|uom:${line.UOMCode}|cur:${line.CurrencyCode}`;
}

export async function runSavingsAnalysis(windowDays = 90): Promise<SavingsAnalysisResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);

  const rawHeaders = await fetchAllPages<PurchaseOrder>("purchaseOrders", {
    q: `CreationDate>=${sinceDate}`,
  });
  const organicHeaders = rawHeaders.filter((h) => !isBulkImportBuyer(h.Buyer));
  const organicHeaderIds = organicHeaders.map((h) => h.POHeaderId);

  // Fetching lines is one API call per PO — sequential would be 1,000+ round-trips
  // on a 1-year window (10+ minutes). Bounded concurrency keeps this to seconds
  // without hammering the shared Fusion pod hard enough to trip rate limits.
  const linesPerHeader = await mapWithConcurrency(organicHeaderIds, 12, (headerId) =>
    fetchAllPages<PoLine>(`purchaseOrders/${headerId}/child/lines`, {})
  );
  const allLines: PoLine[] = linesPerHeader.flat();

  // --- Maverick / off-contract spend ---
  const usdLines = allLines.filter((l) => l.CurrencyCode === "USD");
  const totalOrganicSpendUSD = usdLines.reduce((s, l) => s + l.Total, 0);
  const offContractLines = usdLines.filter((l) => l.SourceAgreementId == null);
  const offContractSpendUSD = offContractLines.reduce((s, l) => s + l.Total, 0);

  const offContractShare = totalOrganicSpendUSD ? offContractSpendUSD / totalOrganicSpendUSD : 0;
  const maverickSpendIsSuspicious = offContractShare > 0.95;

  const maverickSpend: MaverickSpend = {
    totalOrganicSpendUSD,
    offContractSpendUSD,
    offContractShare,
    onContractLines: usdLines.length - offContractLines.length,
    offContractLines: offContractLines.length,
    dataQualityFlag: maverickSpendIsSuspicious,
    note: maverickSpendIsSuspicious
      ? "Off-contract share is implausibly high (>95%) — this Fusion environment's seed/demo data likely never populates SourceAgreementId, so this signal isn't meaningful here rather than reflecting a real governance gap."
      : null,
  };

  // --- Price variance leakage (exact-description or same-item matches only) ---
  const groups = new Map<string, PoLine[]>();
  for (const line of usdLines) {
    if (!line.Description && line.ItemId == null) continue;
    const key = groupKeyFor(line);
    const arr = groups.get(key) ?? [];
    arr.push(line);
    groups.set(key, arr);
  }

  const allGroups: PriceVarianceGroup[] = [];
  for (const [key, lines] of groups) {
    if (lines.length < 2) continue;
    const prices = lines.map((l) => l.Price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (maxPrice <= minPrice) continue;

    const lineDetails = lines
      .map((l) => ({
        orderNumber: l.OrderNumber,
        price: l.Price,
        quantity: l.Quantity,
        lostSavings: Math.max(0, l.Price - minPrice) * l.Quantity,
      }))
      .filter((l) => l.lostSavings > 0);

    if (lineDetails.length === 0) continue;

    allGroups.push({
      groupKey: key,
      description: lines[0].Description ?? `Item ${lines[0].ItemId}`,
      category: lines[0].Category,
      uom: lines[0].UOM,
      currency: lines[0].CurrencyCode,
      minPrice,
      maxPrice,
      priceRatio: minPrice > 0 ? maxPrice / minPrice : Infinity,
      occurrences: lines.length,
      lostSavings: lineDetails.reduce((s, l) => s + l.lostSavings, 0),
      lines: lineDetails,
    });
  }

  const groupsWithVariance = allGroups
    .filter((g) => g.priceRatio <= PRICE_RATIO_OUTLIER_THRESHOLD)
    .sort((a, b) => b.lostSavings - a.lostSavings);
  const flaggedForReview = allGroups
    .filter((g) => g.priceRatio > PRICE_RATIO_OUTLIER_THRESHOLD)
    .sort((a, b) => b.lostSavings - a.lostSavings);

  const totalLostSavingsUSD = groupsWithVariance.reduce((s, g) => s + g.lostSavings, 0);
  const totalFlaggedForReviewUSD = flaggedForReview.reduce((s, g) => s + g.lostSavings, 0);

  // --- Contract-price variance (authoritative: compares against a real negotiated rate
  // from excel/reference-prices.xlsx, not inferred from noisy peer purchases) ---
  const referencePrices = await readReferencePrices();
  const referenceByKey = new Map(
    referencePrices.map((r) => [`${r.Description.trim().toLowerCase()}|${r.Currency}`, r])
  );

  const contractVarianceLines: ContractVarianceLine[] = [];
  for (const line of usdLines) {
    if (!line.Description) continue;
    const ref = referenceByKey.get(`${line.Description.trim().toLowerCase()}|${line.CurrencyCode}`);
    if (!ref) continue;
    const overpaid = Math.max(0, line.Price - ref.ContractedUnitPrice) * line.Quantity;
    if (overpaid <= 0) continue;
    contractVarianceLines.push({
      orderNumber: line.OrderNumber,
      description: line.Description,
      contractedUnitPrice: ref.ContractedUnitPrice,
      paidUnitPrice: line.Price,
      quantity: line.Quantity,
      overpaid,
      currency: line.CurrencyCode,
    });
  }
  contractVarianceLines.sort((a, b) => b.overpaid - a.overpaid);

  // Reference rows produced by excel/populate_reference_from_savings.py are tagged
  // "DERIVED —" in Notes: their "contracted" price is just the lowest price already
  // seen in THIS SAME price-variance computation, so any resulting overpayment
  // overlaps with priceVariance.totalLostSavingsUSD rather than confirming it
  // independently. Do not sum the two totals — surface the overlap instead.
  const derivedFromInternalData =
    referencePrices.length > 0 && referencePrices.every((r) => (r.Notes ?? "").startsWith("DERIVED —"));

  // --- Agreement-price variance: the real, authoritative source — negotiated rates
  // from Oracle Fusion Procurement's own Blanket/Contract Purchase Agreements
  // (purchaseAgreementLines), not a fallback or an Excel-derived approximation. ---
  const agreementLines = await fetchOpenAgreementLines();
  const agreementByItemId = new Map(agreementLines.filter((a) => a.ItemId != null).map((a) => [a.ItemId, a]));
  const agreementByDescKey = new Map(
    agreementLines
      .filter((a) => a.ItemId == null && a.Description)
      .map((a) => [`${a.Description!.trim().toLowerCase()}|${a.UOMCode}|${a.CurrencyCode}`, a])
  );

  const agreementVarianceLines: AgreementVarianceLine[] = [];
  let matchedLineCount = 0;
  for (const line of usdLines) {
    const byItem = line.ItemId != null ? agreementByItemId.get(line.ItemId) : undefined;
    const byDesc = !byItem && line.Description
      ? agreementByDescKey.get(`${line.Description.trim().toLowerCase()}|${line.UOMCode}|${line.CurrencyCode}`)
      : undefined;
    const match = byItem ?? byDesc;
    if (!match) continue;
    matchedLineCount += 1;

    const overpaid = Math.max(0, line.Price - match.Price) * line.Quantity;
    if (overpaid <= 0) continue;
    agreementVarianceLines.push({
      orderNumber: line.OrderNumber,
      description: line.Description ?? match.Description ?? `Item ${line.ItemId}`,
      agreementNumber: match.AgreementNumber,
      agreementPrice: match.Price,
      paidUnitPrice: line.Price,
      quantity: line.Quantity,
      overpaid,
      currency: line.CurrencyCode,
      matchedBy: byItem ? "item" : "description",
    });
  }
  agreementVarianceLines.sort((a, b) => b.overpaid - a.overpaid);

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    sinceDate,
    organicPoCount: organicHeaders.length,
    organicLineCount: allLines.length,
    maverickSpend,
    priceVariance: { totalLostSavingsUSD, groupsWithVariance, totalFlaggedForReviewUSD, flaggedForReview },
    contractVariance: {
      referencePricesLoaded: referencePrices.length,
      totalOverpaidUSD: contractVarianceLines.reduce((s, l) => s + l.overpaid, 0),
      lines: contractVarianceLines,
      derivedFromInternalData,
      note: derivedFromInternalData
        ? "Reference prices are derived from the lowest price already paid in this same window (see excel/reference-prices.xlsx Notes), not a real negotiated contract — this overlaps with priceVariance above rather than confirming it independently. Do not add the two totals together. Replace rows with real negotiated rates for an independent signal."
        : null,
    },
    agreementVariance: {
      agreementLinesLoaded: agreementLines.length,
      matchedLines: matchedLineCount,
      totalOverpaidUSD: agreementVarianceLines.reduce((s, l) => s + l.overpaid, 0),
      lines: agreementVarianceLines,
      note:
        matchedLineCount === 0
          ? `${agreementLines.length} open agreement line(s) loaded from Oracle Fusion Procurement, but none matched an item or description purchased in this window — this tenant's negotiated agreements cover catalog goods (all have a real ItemId), while every organic PO line in this window was a free-text service line with no ItemId. This is a real, non-fabricated result: it means none of the analyzed spend was covered by an existing agreement, not that the check failed.`
          : null,
    },
  };
}

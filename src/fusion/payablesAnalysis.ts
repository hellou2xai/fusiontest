import { fetchAllPages } from "../fusionClient.js";
import { isBulkImportBuyer, type PurchaseOrder } from "./poAnalysis.js";

interface Invoice {
  InvoiceId: number;
  InvoiceNumber: string;
  InvoiceCurrency: string;
  InvoiceAmount: number;
  InvoiceDate: string;
  Supplier: string | null;
  PurchaseOrderNumber: string | null;
  PaidStatus: string;
  ValidationStatus: string;
  ApprovalStatus: string;
}

export interface PayablesAnalysisResult {
  generatedAt: string;
  windowDays: number;
  sinceDate: string;
  totalInvoices: number;
  poMatchedInvoices: number;
  nonPoInvoices: number;
  poMatchedAmountUSD: number;
  nonPoAmountUSD: number;
  organicPoOrderNumbers: number;
  invoicedOrderNumbersNotInWindow: number;
  byPaidStatus: { key: string; count: number; amountUSD: number }[];
}

/**
 * Matches AP invoices (Payables) created in the window to PO order numbers seen in the
 * same window, via invoices.PurchaseOrderNumber. Answers "how much of what we paid for
 * was actually backed by a PO" and gives paid/unpaid status distribution.
 */
export async function runPayablesAnalysis(windowDays = 90): Promise<PayablesAnalysisResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);

  const [invoices, poHeaders] = await Promise.all([
    fetchAllPages<Invoice>("invoices", { q: `CreationDate>=${sinceDate}` }),
    fetchAllPages<PurchaseOrder>("purchaseOrders", { q: `CreationDate>=${sinceDate}` }),
  ]);

  const organicOrderNumbers = new Set(
    poHeaders.filter((h) => !isBulkImportBuyer(h.Buyer)).map((h) => h.OrderNumber)
  );

  const usdInvoices = invoices.filter((i) => i.InvoiceCurrency === "USD");
  const poMatched = usdInvoices.filter((i) => i.PurchaseOrderNumber);
  const nonPo = usdInvoices.filter((i) => !i.PurchaseOrderNumber);
  const invoicedOrderNumbersNotInWindow = poMatched.filter(
    (i) => i.PurchaseOrderNumber && !organicOrderNumbers.has(i.PurchaseOrderNumber)
  ).length;

  const byStatus = new Map<string, { count: number; amountUSD: number }>();
  for (const inv of usdInvoices) {
    const entry = byStatus.get(inv.PaidStatus) ?? { count: 0, amountUSD: 0 };
    entry.count += 1;
    entry.amountUSD += inv.InvoiceAmount;
    byStatus.set(inv.PaidStatus, entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    sinceDate,
    totalInvoices: invoices.length,
    poMatchedInvoices: poMatched.length,
    nonPoInvoices: nonPo.length,
    poMatchedAmountUSD: poMatched.reduce((s, i) => s + i.InvoiceAmount, 0),
    nonPoAmountUSD: nonPo.reduce((s, i) => s + i.InvoiceAmount, 0),
    organicPoOrderNumbers: organicOrderNumbers.size,
    invoicedOrderNumbersNotInWindow,
    byPaidStatus: [...byStatus.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.amountUSD - a.amountUSD),
  };
}

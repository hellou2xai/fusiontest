import { fetchAllPages } from "../fusionClient.js";

export interface PurchaseOrder {
  POHeaderId: number;
  OrderNumber: string;
  Status: string;
  StatusCode: string;
  ProcurementBU: string;
  Buyer: string;
  Supplier: string | null;
  SupplierSite: string | null;
  Ordered: number;
  Total: number;
  CurrencyCode: string;
  CreationDate: string;
  OrderDate: string | null;
  Description: string | null;
}

export interface PoRecord {
  orderNumber: string;
  status: string;
  procurementBU: string;
  buyer: string;
  supplier: string | null;
  supplierSite: string | null;
  ordered: number;
  total: number;
  currency: string;
  creationDate: string;
  orderDate: string | null;
  description: string | null;
  isBulkImport: boolean;
}

export interface GroupTotal {
  key: string;
  count: number;
  totalByCurrency: Record<string, number>;
}

export interface PoAnalysisResult {
  generatedAt: string;
  windowDays: number;
  sinceDate: string;
  totalPurchaseOrders: number;
  organicPurchaseOrders: number;
  bulkImportPurchaseOrders: number;
  totalByCurrency: Record<string, number>;
  organicTotalByCurrency: Record<string, number>;
  byStatus: GroupTotal[];
  bySupplier: GroupTotal[];
  byBuyer: GroupTotal[];
  byProcurementBU: GroupTotal[];
  purchaseOrders: PoRecord[];
}

const BULK_IMPORT_BUYER = /^IMP\d+,\s*SAAS$/i;

export function isBulkImportBuyer(buyer: string | null | undefined): boolean {
  return BULK_IMPORT_BUYER.test((buyer ?? "").trim());
}

function groupBy(records: PoRecord[], keyFn: (r: PoRecord) => string): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const r of records) {
    const key = keyFn(r);
    const g = map.get(key) ?? { key, count: 0, totalByCurrency: {} };
    g.count += 1;
    g.totalByCurrency[r.currency] = (g.totalByCurrency[r.currency] ?? 0) + r.total;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export async function runPoAnalysis(windowDays = 30): Promise<PoAnalysisResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);

  const raw = await fetchAllPages<PurchaseOrder>("purchaseOrders", {
    q: `CreationDate>=${sinceDate}`,
  });

  const purchaseOrders: PoRecord[] = raw.map((po) => ({
    orderNumber: po.OrderNumber,
    status: po.Status,
    procurementBU: po.ProcurementBU,
    buyer: po.Buyer,
    supplier: po.Supplier,
    supplierSite: po.SupplierSite,
    ordered: po.Ordered,
    total: po.Total,
    currency: po.CurrencyCode,
    creationDate: po.CreationDate,
    orderDate: po.OrderDate,
    description: po.Description,
    isBulkImport: isBulkImportBuyer(po.Buyer),
  }));

  const organic = purchaseOrders.filter((p) => !p.isBulkImport);

  const totalByCurrency: Record<string, number> = {};
  const organicTotalByCurrency: Record<string, number> = {};
  for (const p of purchaseOrders) {
    totalByCurrency[p.currency] = (totalByCurrency[p.currency] ?? 0) + p.total;
  }
  for (const p of organic) {
    organicTotalByCurrency[p.currency] = (organicTotalByCurrency[p.currency] ?? 0) + p.total;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    sinceDate,
    totalPurchaseOrders: purchaseOrders.length,
    organicPurchaseOrders: organic.length,
    bulkImportPurchaseOrders: purchaseOrders.length - organic.length,
    totalByCurrency,
    organicTotalByCurrency,
    byStatus: groupBy(organic, (r) => r.status),
    bySupplier: groupBy(organic, (r) => r.supplier ?? "Unspecified"),
    byBuyer: groupBy(organic, (r) => r.buyer),
    byProcurementBU: groupBy(organic, (r) => r.procurementBU),
    purchaseOrders,
  };
}

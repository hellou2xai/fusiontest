import { fetchAllPages, mapWithConcurrency } from "../fusionClient.js";

export interface PoSchedule {
  LineLocationId: number;
  POLineId: number;
  POHeaderId: number;
  ScheduleNumber: number;
  Status: string;
  Quantity: number;
  Ordered: number;
  ReceivedQuantity: number;
  ReceivedAmount: number;
  BilledQuantity: number;
  BilledAmount: number;
  InvoiceMatchOption: string;
  DestinationType: string;
  ShipToOrganization: string | null;
  RequestedDeliveryDate: string | null;
  PromisedDeliveryDate: string | null;
}

export interface PoDistribution {
  PODistributionId: number;
  POLineId: number;
  POHeaderId: number;
  DistributionNumber: number;
  Quantity: number;
  Ordered: number;
  Total: number;
  CurrencyCode: string;
  POChargeAccount: string | null;
  POAccrualAccount: string | null;
}

export interface PoDatasetLine {
  POLineId: number;
  LineNumber: number;
  Description: string | null;
  Category: string | null;
  UOM: string;
  Quantity: number;
  Price: number;
  Total: number;
  CurrencyCode: string;
  SourceAgreementNumber: string | null;
  schedules: (PoSchedule & { distributions: PoDistribution[] })[];
}

export interface CompletePoDataset {
  orderNumber: string;
  headerId: number;
  header: Record<string, unknown>;
  lines: PoDatasetLine[];
  fetchedAt: string;
}

/**
 * Assembles the full document flow for a single PO: header -> lines -> schedules
 * (receiving/billing status) -> distributions (GL accounting). One PO at a time —
 * this is a deep drill-down, not a bulk-window scan (see runPoAnalysis for that).
 */
export async function fetchCompletePoDataset(orderNumber: string): Promise<CompletePoDataset> {
  const headers = await fetchAllPages<Record<string, unknown>>("purchaseOrders", {
    q: `OrderNumber=${orderNumber}`,
  });
  const header = headers[0];
  if (!header) throw new Error(`No purchase order found with OrderNumber=${orderNumber}`);
  const headerId = header.POHeaderId as number;

  const rawLines = await fetchAllPages<Record<string, unknown>>(`purchaseOrders/${headerId}/child/lines`, {});

  // A PO with N lines needs N schedule fetches, each followed by a distributions
  // fetch per schedule — sequentially that's 2N+ round-trips (~40s+ for a 24-line
  // PO). Parallelize both levels.
  const lines: PoDatasetLine[] = await mapWithConcurrency(rawLines, 8, async (line) => {
    const lineId = line.POLineId as number;
    const schedules = await fetchAllPages<PoSchedule>(
      `purchaseOrders/${headerId}/child/lines/${lineId}/child/schedules`,
      {}
    );

    const schedulesWithDistributions = await mapWithConcurrency(schedules, 8, async (schedule) => ({
      ...schedule,
      distributions: await fetchAllPages<PoDistribution>(
        `purchaseOrders/${headerId}/child/lines/${lineId}/child/schedules/${schedule.LineLocationId}/child/distributions`,
        {}
      ),
    }));

    return {
      POLineId: lineId,
      LineNumber: line.LineNumber as number,
      Description: line.Description as string | null,
      Category: line.Category as string | null,
      UOM: line.UOM as string,
      Quantity: line.Quantity as number,
      Price: line.Price as number,
      Total: line.Total as number,
      CurrencyCode: line.CurrencyCode as string,
      SourceAgreementNumber: line.SourceAgreementNumber as string | null,
      schedules: schedulesWithDistributions,
    };
  });

  return {
    orderNumber,
    headerId,
    header,
    lines,
    fetchedAt: new Date().toISOString(),
  };
}


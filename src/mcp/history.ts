import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PoAnalysisResult } from "../fusion/poAnalysis.js";
import { REPORTS_DIR } from "../paths.js";

export interface HistorySnapshot {
  file: string;
  generatedAt: string;
  totalPurchaseOrders: number;
  organicPurchaseOrders: number;
  bulkImportPurchaseOrders: number;
  organicTotalByCurrency: Record<string, number>;
}

/** Lists all persisted po-analysis snapshots, oldest to newest. */
export async function listHistory(): Promise<HistorySnapshot[]> {
  let files: string[];
  try {
    files = await readdir(REPORTS_DIR);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.startsWith("po-analysis-") && f.endsWith(".json")).sort();

  const snapshots: HistorySnapshot[] = [];
  for (const file of jsonFiles) {
    const content = await readFile(path.join(REPORTS_DIR, file), "utf8");
    const data = JSON.parse(content) as PoAnalysisResult;
    snapshots.push({
      file,
      generatedAt: data.generatedAt,
      totalPurchaseOrders: data.totalPurchaseOrders,
      organicPurchaseOrders: data.organicPurchaseOrders,
      bulkImportPurchaseOrders: data.bulkImportPurchaseOrders,
      organicTotalByCurrency: data.organicTotalByCurrency,
    });
  }
  return snapshots;
}

export interface HistoryTrend {
  snapshots: HistorySnapshot[];
  latest: HistorySnapshot | null;
  previous: HistorySnapshot | null;
  deltaOrganicPOs: number | null;
  deltaOrganicUSD: number | null;
}

/** Compares the two most recent snapshots to surface a simple trend signal. */
export async function getTrend(): Promise<HistoryTrend> {
  const snapshots = await listHistory();
  const latest = snapshots[snapshots.length - 1] ?? null;
  const previous = snapshots[snapshots.length - 2] ?? null;

  return {
    snapshots,
    latest,
    previous,
    deltaOrganicPOs: latest && previous ? latest.organicPurchaseOrders - previous.organicPurchaseOrders : null,
    deltaOrganicUSD:
      latest && previous
        ? (latest.organicTotalByCurrency.USD ?? 0) - (previous.organicTotalByCurrency.USD ?? 0)
        : null,
  };
}

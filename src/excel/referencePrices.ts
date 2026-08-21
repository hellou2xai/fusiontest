import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../paths.js";

export interface ReferencePriceRow {
  Category: string | null;
  Description: string;
  Supplier: string | null;
  ContractedUnitPrice: number;
  Currency: string;
  UOM: string | null;
  Notes: string | null;
}

interface ReadResult {
  rows: ReferencePriceRow[];
  liveAttached: boolean;
}

const READ_SCRIPT = path.join(PROJECT_ROOT, "excel", "read_reference_prices.py");
const WORKBOOK_PATH = path.join(PROJECT_ROOT, "excel", "reference-prices.xlsx");

// Only cache the "workbook is closed, read from disk" case — safe because that
// state only changes on save (mtime moves). When the workbook is open in Excel
// (liveAttached: true), someone may be editing it right now with unsaved
// changes, so every call re-reads live rather than trusting a cache that a
// live edit wouldn't invalidate.
let diskCache: { mtimeMs: number; rows: ReferencePriceRow[] } | null = null;

export async function readReferencePrices(): Promise<ReferencePriceRow[]> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(WORKBOOK_PATH)).mtimeMs;
  } catch {
    return []; // workbook doesn't exist yet
  }

  if (diskCache && diskCache.mtimeMs === mtimeMs) {
    return diskCache.rows;
  }

  const result = await readReferencePricesUncached();
  if (!result.liveAttached) {
    diskCache = { mtimeMs, rows: result.rows };
  } else {
    diskCache = null; // invalidate — next disk-only read must not reuse a stale live snapshot
  }
  return result.rows;
}

function readReferencePricesUncached(): Promise<ReadResult> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [READ_SCRIPT], { cwd: PROJECT_ROOT });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));

    proc.on("error", (err) => {
      console.error("Failed to spawn python for reference prices:", err.message);
      resolve({ rows: [], liveAttached: false });
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error("read_reference_prices.py failed:", stderr.trim());
        resolve({ rows: [], liveAttached: false });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        console.error("Could not parse reference prices JSON:", stdout.slice(0, 200));
        resolve({ rows: [], liveAttached: false });
      }
    });
  });
}

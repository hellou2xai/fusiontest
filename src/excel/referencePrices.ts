import { spawn } from "node:child_process";
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

const READ_SCRIPT = path.join(PROJECT_ROOT, "excel", "read_reference_prices.py");

/**
 * Reads excel/reference-prices.xlsx via a Python/xlwings subprocess and returns
 * its rows. Returns [] if the workbook doesn't exist yet (run
 * `python excel/create_reference_template.py` to create it) or if Python/xlwings
 * isn't available — contract-price comparison is best-effort, not a hard
 * dependency for the rest of the savings analysis.
 */
export function readReferencePrices(): Promise<ReferencePriceRow[]> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [READ_SCRIPT], { cwd: PROJECT_ROOT });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));

    proc.on("error", (err) => {
      console.error("Failed to spawn python for reference prices:", err.message);
      resolve([]);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error("read_reference_prices.py failed:", stderr.trim());
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        console.error("Could not parse reference prices JSON:", stdout.slice(0, 200));
        resolve([]);
      }
    });
  });
}

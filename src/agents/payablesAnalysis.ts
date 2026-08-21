import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPayablesAnalysis } from "../fusion/payablesAnalysis.js";
import { REPORTS_DIR } from "../paths.js";

const usd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const windowDays = Number(process.argv[2] ?? 90);
  console.log(`Analyzing Payables activity over the last ${windowDays} days...`);

  const result = await runPayablesAnalysis(windowDays);

  console.log(`\nTotal invoices: ${result.totalInvoices}`);
  console.log(`PO-matched:     ${result.poMatchedInvoices} invoices, $${usd(result.poMatchedAmountUSD)}`);
  console.log(`Non-PO:         ${result.nonPoInvoices} invoices, $${usd(result.nonPoAmountUSD)}`);
  console.log(
    `${result.invoicedOrderNumbersNotInWindow} PO-matched invoice(s) reference a PO not created in this same window (older PO, paid later).`
  );

  console.log(`\nBy paid status:`);
  for (const s of result.byPaidStatus) {
    console.log(`  ${s.key}: ${s.count} invoices, $${usd(s.amountUSD)}`);
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const stamp = result.generatedAt.slice(0, 10);
  const jsonPath = path.join(REPORTS_DIR, `payables-analysis-${stamp}.json`);
  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nWrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

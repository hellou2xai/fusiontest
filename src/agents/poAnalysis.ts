import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPoAnalysis } from "../fusion/poAnalysis.js";
import { REPORTS_DIR } from "../paths.js";

function formatCurrencyTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals).filter(([, v]) => v);
  if (entries.length === 0) return "0";
  return entries
    .map(([ccy, amount]) => `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`)
    .join(", ");
}

async function main() {
  const windowDays = Number(process.argv[2] ?? 30);
  const result = await runPoAnalysis(windowDays);

  console.log(`Fetched ${result.totalPurchaseOrders} purchase order(s) since ${result.sinceDate}.`);
  console.log(`  organic: ${result.organicPurchaseOrders}, bulk-import: ${result.bulkImportPurchaseOrders}`);

  await mkdir(REPORTS_DIR, { recursive: true });
  const stamp = result.generatedAt.slice(0, 10);
  const jsonPath = path.join(REPORTS_DIR, `po-analysis-${stamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `po-analysis-${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");

  const md = [
    `# Purchase Order Analysis — Last ${result.windowDays} Days`,
    ``,
    `Generated: ${result.generatedAt}`,
    `Window: ${result.sinceDate} → today`,
    `Total POs: **${result.totalPurchaseOrders}** (organic: ${result.organicPurchaseOrders}, bulk-import: ${result.bulkImportPurchaseOrders})`,
    `Organic spend: **${formatCurrencyTotals(result.organicTotalByCurrency)}**`,
    ``,
    `## By Status (organic only)`,
    `| Status | Count | Total |`,
    `|---|---|---|`,
    ...result.byStatus.map((g) => `| ${g.key} | ${g.count} | ${formatCurrencyTotals(g.totalByCurrency)} |`),
    ``,
    `## By Supplier (organic only)`,
    `| Supplier | Count | Total |`,
    `|---|---|---|`,
    ...result.bySupplier.map((g) => `| ${g.key} | ${g.count} | ${formatCurrencyTotals(g.totalByCurrency)} |`),
    ``,
    `## By Buyer (organic only)`,
    `| Buyer | Count | Total |`,
    `|---|---|---|`,
    ...result.byBuyer.map((g) => `| ${g.key} | ${g.count} | ${formatCurrencyTotals(g.totalByCurrency)} |`),
    ``,
    `## By Procurement BU (organic only)`,
    `| BU | Count | Total |`,
    `|---|---|---|`,
    ...result.byProcurementBU.map((g) => `| ${g.key} | ${g.count} | ${formatCurrencyTotals(g.totalByCurrency)} |`),
    ``,
    `## Organic Purchase Orders`,
    `| Order # | Status | BU | Buyer | Supplier | Total | Order Date |`,
    `|---|---|---|---|---|---|---|`,
    ...result.purchaseOrders
      .filter((po) => !po.isBulkImport)
      .map(
        (po) =>
          `| ${po.orderNumber} | ${po.status} | ${po.procurementBU} | ${po.buyer} | ${po.supplier ?? "-"} | ${po.total.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${po.currency} | ${po.orderDate ?? "-"} |`
      ),
    ``,
  ].join("\n");

  await writeFile(mdPath, md, "utf8");

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

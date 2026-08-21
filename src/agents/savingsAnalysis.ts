import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runSavingsAnalysis } from "../fusion/savingsAnalysis.js";
import { REPORTS_DIR } from "../paths.js";

const usd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const windowDays = Number(process.argv[2] ?? 90);
  console.log(`Analyzing savings opportunity over the last ${windowDays} days...`);

  const result = await runSavingsAnalysis(windowDays);

  console.log(`\nOrganic POs: ${result.organicPoCount}, lines: ${result.organicLineCount}`);
  console.log(`\n--- Off-contract (maverick) spend ---`);
  console.log(`Total organic USD spend: $${usd(result.maverickSpend.totalOrganicSpendUSD)}`);
  console.log(
    `Off-contract spend:      $${usd(result.maverickSpend.offContractSpendUSD)} (${(result.maverickSpend.offContractShare * 100).toFixed(1)}% of spend, ${result.maverickSpend.offContractLines} of ${result.maverickSpend.offContractLines + result.maverickSpend.onContractLines} lines)`
  );
  if (result.maverickSpend.note) console.log(`  ⚑ ${result.maverickSpend.note}`);

  console.log(`\n--- Price variance leakage (same item/description, different price paid) ---`);
  console.log(`Credible overpayment (≤${5}x price spread): $${usd(result.priceVariance.totalLostSavingsUSD)}`);
  for (const g of result.priceVariance.groupsWithVariance.slice(0, 10)) {
    console.log(
      `  "${g.description}" (${g.category ?? "n/a"}) — paid $${usd(g.minPrice)}-$${usd(g.maxPrice)}/${g.uom} (${g.priceRatio.toFixed(1)}x) across ${g.occurrences} lines, overpaid $${usd(g.lostSavings)}`
    );
  }

  if (result.priceVariance.flaggedForReview.length > 0) {
    console.log(
      `\n  ⚑ ${result.priceVariance.flaggedForReview.length} group(s) totaling $${usd(result.priceVariance.totalFlaggedForReviewUSD)} flagged for review (>${5}x price spread — likely data quality, not real variance):`
    );
    for (const g of result.priceVariance.flaggedForReview.slice(0, 5)) {
      console.log(`    "${g.description}" — $${usd(g.minPrice)}-$${usd(g.maxPrice)}/${g.uom} (${g.priceRatio.toFixed(0)}x)`);
    }
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const stamp = result.generatedAt.slice(0, 10);
  const jsonPath = path.join(REPORTS_DIR, `savings-analysis-${stamp}.json`);
  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nWrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

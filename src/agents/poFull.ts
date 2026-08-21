import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchCompletePoDataset } from "../fusion/poDataset.js";
import { REPORTS_DIR } from "../paths.js";

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) {
    console.error("Usage: npm run po:full -- <OrderNumber>");
    process.exit(1);
  }

  console.log(`Fetching complete document flow for PO ${orderNumber}...`);
  const dataset = await fetchCompletePoDataset(orderNumber);

  console.log(`\nHeader: ${dataset.header.Status} — ${dataset.header.Supplier} — ${dataset.header.Total} ${dataset.header.CurrencyCode}`);
  for (const line of dataset.lines) {
    console.log(`\nLine ${line.LineNumber}: ${line.Description ?? "(no description)"} — ${line.Total} ${line.CurrencyCode}`);
    for (const sched of line.schedules) {
      console.log(
        `  Schedule ${sched.ScheduleNumber} [${sched.Status}]: ordered ${sched.Ordered}, received ${sched.ReceivedAmount} (qty ${sched.ReceivedQuantity}), billed ${sched.BilledAmount} (qty ${sched.BilledQuantity}), match=${sched.InvoiceMatchOption}`
      );
      for (const dist of sched.distributions) {
        console.log(`    Distribution ${dist.DistributionNumber}: ${dist.Total} ${dist.CurrencyCode} -> ${dist.POChargeAccount ?? "n/a"}`);
      }
    }
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const jsonPath = path.join(REPORTS_DIR, `po-full-${orderNumber}.json`);
  await writeFile(jsonPath, JSON.stringify(dataset, null, 2), "utf8");
  console.log(`\nWrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

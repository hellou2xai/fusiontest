"""
Populates excel/reference-prices.xlsx from the lowest price already paid for each
item, using the most recent reports/savings-analysis-*.json (already outlier-
filtered — the >5x-ratio noise groups are excluded upstream, before this ever
sees them).

This is NOT a real negotiated contract rate. It's a legitimate but different
signal: "the best price we've already achieved for this item, elsewhere in our
own purchasing." Every row is labeled as derived, not authoritative, so it can't
be mistaken for real contract data. Replace individual rows with actual
negotiated rates as they become available — this just gives honest, broad
starting coverage instead of 3 hand-picked examples.

Usage: python excel/populate_reference_from_savings.py
"""
import json
import sys
from datetime import datetime, timezone
from glob import glob
from pathlib import Path
import xlwings as xw

ROOT = Path(__file__).parent.parent
REPORTS_DIR = ROOT / "reports"
OUT_PATH = Path(__file__).parent / "reference-prices.xlsx"

HEADERS = ["Category", "Description", "Supplier", "ContractedUnitPrice", "Currency", "UOM", "Notes"]


def latest_savings_report():
    matches = sorted(glob(str(REPORTS_DIR / "savings-analysis-*.json")))
    if not matches:
        return None, None
    path = matches[-1]
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), path


def main():
    data, path = latest_savings_report()
    if not data:
        print("No reports/savings-analysis-*.json found — run 'npm run savings:analyze -- 90' first.")
        sys.exit(1)

    groups = data["priceVariance"]["groupsWithVariance"]
    if not groups:
        print("No credible price-variance groups in the latest report — nothing to populate.")
        sys.exit(1)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = []
    for g in groups:
        note = (
            f"DERIVED — lowest of {g['occurrences']} price(s) paid for this item in the "
            f"{data['windowDays']}-day window as of {stamp}. NOT an authoritative negotiated "
            f"contract rate — replace with a real rate when available."
        )
        rows.append([g["category"] or "", g["description"], "", g["minPrice"], g["currency"], g["uom"], note])

    app = xw.App(visible=False)
    try:
        book = app.books.add()
        sheet = book.sheets[0]
        sheet.name = "Reference Prices"
        sheet["A1"].value = [HEADERS] + rows
        header_range = sheet["A1"].resize(1, len(HEADERS))
        header_range.font.bold = True
        sheet.range("A1").expand("table").columns.autofit()
        sheet.range("A2").select()
        app.api.ActiveWindow.FreezePanes = True
        book.save(str(OUT_PATH))
        book.close()
        print(f"Wrote {len(rows)} derived reference price(s) to {OUT_PATH} (from {path})")
    finally:
        app.quit()


if __name__ == "__main__":
    main()

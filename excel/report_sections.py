"""
Shared sheet-writing logic for the Fusion report workbook. Used by both
write_report.py (standalone export, spawned from Node/CLI) and
refresh_from_reports.py (the RunPython target called from the "Refresh from
Fusion" button inside the live workbook) — one set of logic, two entry points,
so the button and the CLI/dashboard export always produce identical sheets.
"""
import json
from glob import glob
from pathlib import Path

ROOT = Path(__file__).parent.parent
REPORTS_DIR = ROOT / "reports"


def latest(pattern: str):
    matches = sorted(glob(str(REPORTS_DIR / pattern)))
    if not matches:
        return None
    with open(matches[-1], "r", encoding="utf-8") as f:
        return json.load(f)


def load_latest_reports():
    return {
        "po": latest("po-analysis-*.json"),
        "savings": latest("savings-analysis-*.json"),
        "payables": latest("payables-analysis-*.json"),
    }


def write_header(sheet, row, headers):
    sheet.range((row, 1)).value = headers
    header_range = sheet.range((row, 1)).resize(1, len(headers))
    header_range.font.bold = True
    header_range.color = (230, 235, 241)


def money(n):
    return round(n or 0, 2)


def write_po_summary(book, data):
    if not data:
        return
    sheet = book.sheets.add("PO Summary", after=book.sheets[-1]) if "PO Summary" not in [s.name for s in book.sheets] else book.sheets["PO Summary"]
    sheet.clear()
    sheet.range("A1").value = "Purchase Order Summary"
    sheet.range("A1").font.bold = True
    sheet.range("A1").font.size = 14
    sheet.range("A2").value = f"Window: {data['sinceDate']} -> today ({data['windowDays']} days)"
    sheet.range("A3").value = f"Organic POs: {data['organicPurchaseOrders']}  |  Bulk-import (excluded): {data['bulkImportPurchaseOrders']}"

    row = 5
    write_header(sheet, row, ["Order #", "Status", "BU", "Buyer", "Supplier", "Total", "Currency", "Order Date"])
    row += 1
    organic = [p for p in data["purchaseOrders"] if not p.get("isBulkImport")]
    for po in organic:
        sheet.range((row, 1)).value = [
            po["orderNumber"], po["status"], po["procurementBU"], po["buyer"],
            po["supplier"], money(po["total"]), po["currency"], po.get("orderDate") or "",
        ]
        row += 1
    sheet.range("A5").expand("table").columns.autofit()
    sheet.range((6, 6), (row - 1, 6)).number_format = "#,##0.00"


def write_savings(book, data):
    if not data:
        return
    sheet = book.sheets.add("Savings Opportunity", after=book.sheets[-1]) if "Savings Opportunity" not in [s.name for s in book.sheets] else book.sheets["Savings Opportunity"]
    sheet.clear()
    sheet.range("A1").value = "Savings Opportunity"
    sheet.range("A1").font.bold = True
    sheet.range("A1").font.size = 14
    sheet.range("A2").value = f"Window: {data['sinceDate']} -> today ({data['windowDays']} days)"
    sheet.range("A3").value = f"Credible price-variance overpayment: ${money(data['priceVariance']['totalLostSavingsUSD']):,.2f}"
    sheet.range("A4").value = f"Flagged for review (likely data noise): ${money(data['priceVariance']['totalFlaggedForReviewUSD']):,.2f}"
    if data["maverickSpend"].get("note"):
        sheet.range("A5").value = f"Note: {data['maverickSpend']['note']}"

    row = 7
    av = data.get("agreementVariance", {"agreementLinesLoaded": 0, "matchedLines": 0, "totalOverpaidUSD": 0, "lines": [], "note": None})
    sheet.range((row, 1)).value = "Agreement-Price Variance (real Oracle Fusion Blanket/Contract Agreements)"
    sheet.range((row, 1)).font.bold = True
    row += 1
    sheet.range((row, 1)).value = (
        f"Agreement lines loaded: {av['agreementLinesLoaded']}  |  Matched to organic POs: {av['matchedLines']}  |  "
        f"Total overpaid vs. agreement price: ${money(av['totalOverpaidUSD']):,.2f}"
    )
    row += 1
    if av.get("note"):
        sheet.range((row, 1)).value = f"Note: {av['note']}"
        row += 1
    row += 1
    av_header_row = row
    write_header(sheet, row, ["Order #", "Description", "Agreement #", "Matched By", "Agreement Price", "Paid", "Overpaid"])
    row += 1
    for l in av["lines"]:
        sheet.range((row, 1)).value = [
            l["orderNumber"], l["description"], l["agreementNumber"], l["matchedBy"],
            money(l["agreementPrice"]), money(l["paidUnitPrice"]), money(l["overpaid"]),
        ]
        row += 1
    if av["lines"]:
        sheet.range((av_header_row, 5), (row - 1, 7)).number_format = "#,##0.00"
    row += 2

    pv_header_row = row
    write_header(sheet, row, ["Description", "Category", "Min Price", "Max Price", "Ratio", "Occurrences", "Overpaid"])
    row += 1
    for g in data["priceVariance"]["groupsWithVariance"]:
        sheet.range((row, 1)).value = [
            g["description"], g["category"] or "", money(g["minPrice"]), money(g["maxPrice"]),
            round(g["priceRatio"], 1), g["occurrences"], money(g["lostSavings"]),
        ]
        row += 1
    if data["priceVariance"]["groupsWithVariance"]:
        sheet.range((pv_header_row + 1, 3), (row - 1, 4)).number_format = "#,##0.00"
        sheet.range((pv_header_row + 1, 7), (row - 1, 7)).number_format = "#,##0.00"

    row += 2
    cv = data.get("contractVariance", {"referencePricesLoaded": 0, "totalOverpaidUSD": 0, "lines": []})
    sheet.range((row, 1)).value = "Contract-Price Variance (vs. reference-prices.xlsx)"
    sheet.range((row, 1)).font.bold = True
    row += 1
    sheet.range((row, 1)).value = f"Reference prices loaded: {cv['referencePricesLoaded']}  |  Total overpaid vs. contract: ${money(cv['totalOverpaidUSD']):,.2f}"
    row += 1
    if cv.get("note"):
        sheet.range((row, 1)).value = f"Note: {cv['note']}"
        row += 1
    row += 1
    cv_header_row = row
    write_header(sheet, row, ["Order #", "Description", "Contracted", "Paid", "Qty", "Overpaid"])
    row += 1
    for l in cv["lines"]:
        sheet.range((row, 1)).value = [
            l["orderNumber"], l["description"], money(l["contractedUnitPrice"]),
            money(l["paidUnitPrice"]), l["quantity"], money(l["overpaid"]),
        ]
        row += 1
    if cv["lines"]:
        sheet.range((cv_header_row, 3), (row - 1, 4)).number_format = "#,##0.00"
        sheet.range((cv_header_row, 6), (row - 1, 6)).number_format = "#,##0.00"

    sheet.used_range.columns.autofit()


def write_payables(book, data):
    if not data:
        return
    sheet = book.sheets.add("Payables", after=book.sheets[-1]) if "Payables" not in [s.name for s in book.sheets] else book.sheets["Payables"]
    sheet.clear()
    sheet.range("A1").value = "Payables Summary"
    sheet.range("A1").font.bold = True
    sheet.range("A1").font.size = 14
    sheet.range("A2").value = f"Window: {data['sinceDate']} -> today ({data['windowDays']} days)"
    sheet.range("A3").value = f"Total invoices: {data['totalInvoices']}  |  PO-matched: {data['poMatchedInvoices']}  |  Non-PO: {data['nonPoInvoices']}"

    row = 5
    write_header(sheet, row, ["Paid Status", "Count", "Amount (USD)"])
    row += 1
    for s in data["byPaidStatus"]:
        sheet.range((row, 1)).value = [s["key"], s["count"], money(s["amountUSD"])]
        row += 1
    sheet.range("A5").expand("table").columns.autofit()
    sheet.range((6, 3), (row - 1, 3)).number_format = "#,##0.00"


def write_all_sections(book, reports):
    write_po_summary(book, reports["po"])
    write_savings(book, reports["savings"])
    write_payables(book, reports["payables"])

"""
RunPython entry point for the "Refresh from Fusion" button embedded in
fusion-report.xlsx. Re-reads the latest reports/*.json and rewrites the sheets
of the CALLING (live, open) workbook — this is what makes the button in Excel
actually do something, rather than Excel only ever being written to from
outside.

Deliberately does NOT trigger a fresh Fusion API fetch itself: that can take
20s-2min on this tenant (see savingsAnalysis.ts's own timing notes), and
RunPython blocks Excel's UI thread while it runs — a multi-minute Fusion query
would freeze Excel, which is a worse experience than a fast "pull the latest
already-computed analysis" action. Run the CLI/dashboard to fetch fresh data
first, then click this button to pull it into the live sheet.
"""
import xlwings as xw
from report_sections import load_latest_reports, write_all_sections


def main():
    book = xw.Book.caller()
    reports = load_latest_reports()

    if not any(reports.values()):
        book.sheets[0].range("A1").value = "No reports found in reports/ — run po:analyze / savings:analyze / payables:analyze first."
        return

    write_all_sections(book, reports)
    book.sheets[0].activate()


if __name__ == "__main__":
    xw.Book("fusion-report.xlsx").set_mock_caller()
    main()

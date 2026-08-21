"""
Reads excel/reference-prices.xlsx and prints its rows as JSON on stdout.
Called from Node (src/fusion/referencePrices.ts) as a subprocess — this is the
"read FROM Excel into the analysis" direction of the xlwings integration.

Live-attaches if the workbook is already open in Excel, reading whatever is
currently in the live sheet — including edits nobody has saved yet. This is
the actual two-way part: someone can type a real negotiated rate into an open
workbook and the very next analysis run picks it up, no save required. Falls
back to a headless open-from-disk (and reports liveAttached: false) when the
workbook isn't currently open anywhere.
"""
import json
import sys
from pathlib import Path
import xlwings as xw

PATH = Path(__file__).parent / "reference-prices.xlsx"


def read_rows(sheet):
    values = sheet.range("A1").expand("table").value
    headers = [str(h) for h in values[0]]
    rows = []
    for row in values[1:]:
        record = dict(zip(headers, row))
        if record.get("Description"):
            rows.append(record)
    return rows


def main():
    if not PATH.exists():
        print(json.dumps({"rows": [], "liveAttached": False}))
        return

    if xw.apps.count > 0:
        book = xw.Book(str(PATH))
        rows = read_rows(book.sheets[0])
        print(json.dumps({"rows": rows, "liveAttached": True}))
        return

    app = xw.App(visible=False)
    try:
        book = app.books.open(str(PATH))
        try:
            rows = read_rows(book.sheets[0])
            print(json.dumps({"rows": rows, "liveAttached": False}))
        finally:
            book.close()
    finally:
        app.quit()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

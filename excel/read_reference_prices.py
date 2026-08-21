"""
Reads excel/reference-prices.xlsx and prints its rows as a JSON array on stdout.
Called from Node (src/fusion/referencePrices.ts) as a subprocess — this is the
"read FROM Excel into the analysis" direction of the xlwings integration.

Runs headless (visible=False) since this is a data read, not a demo moment —
see write_report.py for the visible, live-population version used in the demo.
"""
import json
import sys
from pathlib import Path
import xlwings as xw

PATH = Path(__file__).parent / "reference-prices.xlsx"


def main():
    if not PATH.exists():
        print(json.dumps([]))
        return

    app = xw.App(visible=False)
    try:
        book = app.books.open(str(PATH))
        try:
            sheet = book.sheets[0]
            values = sheet.range("A1").expand("table").value
            headers = [str(h) for h in values[0]]
            rows = []
            for row in values[1:]:
                record = dict(zip(headers, row))
                if record.get("Description"):
                    rows.append(record)
            print(json.dumps(rows))
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

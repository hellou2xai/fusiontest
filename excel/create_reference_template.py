"""
Creates excel/reference-prices.xlsx — a negotiated/contracted unit price list.
Run once (`python excel/create_reference_template.py`) to seed a headers-only
template, then fill it in with REAL negotiated rates yourself (or use
populate_reference_from_savings.py for a derived-but-not-fabricated fallback,
clearly labeled as such — see that script's docstring).

Deliberately headers-only, no example/placeholder numbers: this file feeds a
savings-analysis output that gets presented in demos, and fabricated example
rows have previously been mistaken for real data. Do not add hardcoded example
rows back in.
"""
import xlwings as xw
from pathlib import Path

PATH = Path(__file__).parent / "reference-prices.xlsx"

HEADERS = ["Category", "Description", "Supplier", "ContractedUnitPrice", "Currency", "UOM", "Notes"]


def main():
    app = xw.App(visible=False)
    try:
        book = app.books.add()
        sheet = book.sheets[0]
        sheet.name = "Reference Prices"
        sheet["A1"].value = [HEADERS]
        header_range = sheet["A1"].resize(1, len(HEADERS))
        header_range.font.bold = True
        sheet.range("A1").expand("table").columns.autofit()
        sheet.range("A2").select()
        app.api.ActiveWindow.FreezePanes = True
        book.save(str(PATH))
        book.close()
        print(f"Wrote {PATH} (headers only — no example data)")
    finally:
        app.quit()


if __name__ == "__main__":
    main()

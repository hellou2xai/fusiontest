"""
Creates excel/reference-prices.xlsx — a negotiated/contracted unit price list.
Run once (`python excel/create_reference_template.py`) to seed the template, then
edit the workbook directly with real contracted rates. read_reference_prices.py
reads whatever is in this file at analysis time.

The example rows are placeholders illustrating the expected shape — replace them
with real negotiated rates before trusting the contract-variance numbers.
"""
import xlwings as xw
from pathlib import Path

PATH = Path(__file__).parent / "reference-prices.xlsx"

HEADERS = ["Category", "Description", "Supplier", "ContractedUnitPrice", "Currency", "UOM", "Notes"]

EXAMPLE_ROWS = [
    ["Business Liability Insurance", "Business Liability Insurance", "", 1450000, "USD", "Ea", "EXAMPLE — replace with real rate"],
    ["Contractor Expense", "Outside Contractors", "", 15000, "USD", "Ea", "EXAMPLE — replace with real rate"],
    ["Marketing General", "Marketing Expenses", "", 12000, "USD", "Ea", "EXAMPLE — replace with real rate"],
]


def main():
    app = xw.App(visible=False)
    try:
        book = app.books.add()
        sheet = book.sheets[0]
        sheet.name = "Reference Prices"
        sheet["A1"].value = [HEADERS] + EXAMPLE_ROWS
        header_range = sheet["A1"].resize(1, len(HEADERS))
        header_range.font.bold = True
        sheet.range("A1").expand("table").columns.autofit()
        sheet.range("A2").select()
        app.api.ActiveWindow.FreezePanes = True
        book.save(str(PATH))
        book.close()
        print(f"Wrote {PATH}")
    finally:
        app.quit()


if __name__ == "__main__":
    main()

"""
One-time setup: makes fusion-report.xlsx self-contained for RunPython, so it
works without relying on Excel's XLSTART add-in loading correctly (which
turned out not to auto-load on this machine — a per-install XLSTART path
quirk, not something worth depending on). Instead:

  1. Imports xlwings.bas (the RunPython VBA implementation) directly into the
     workbook's own VBA project.
  2. Adds a hidden "xlwings.conf" sheet pinning INTERPRETER_WIN to the exact
     python3.exe that has xlwings installed — plain "python" on this machine
     resolves to a DIFFERENT Python 3.12 install with no xlwings, which is
     exactly the bug that silently broke the Node-side Excel calls earlier
     this session (see PROGRESS.md). Pin it explicitly rather than relying on
     PATH resolution again.
  3. Adds a "RefreshFromFusion" macro + button wired to refresh_from_reports.py.

Re-running is safe — replaces the config sheet, macro module, and button.

Requires "Trust access to the VBA project object model" enabled in Excel's
Trust Center (already confirmed enabled on this machine).

Usage: python excel/add_refresh_button.py
"""
import subprocess
import sys
from pathlib import Path
import xlwings as xw

ROOT = Path(__file__).parent.parent
OUT_PATH = ROOT / "reports" / "fusion-report.xlsx"
EXCEL_DIR = str(Path(__file__).parent)
XLWINGS_BAS = Path(xw.__path__[0]) / "xlwings.bas"

MODULE_NAME = "FusionRefresh"
MACRO_NAME = "RefreshFromFusion"
CONFIG_SHEET_NAME = "xlwings.conf"

MACRO_CODE = f"""Sub {MACRO_NAME}()
    RunPython "import sys; sys.path.insert(0, r'{EXCEL_DIR}'); import refresh_from_reports; refresh_from_reports.main()"
End Sub
"""


def resolve_python3() -> str:
    """Finds the exact python3 executable that has xlwings installed, rather
    than trusting whatever plain 'python'/'python3' resolves to at runtime."""
    result = subprocess.run(["python3", "-c", "import sys; print(sys.executable)"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("Could not resolve a working python3 interpreter")
    return result.stdout.strip()


def set_config(book, key: str, value: str):
    if CONFIG_SHEET_NAME in [s.name for s in book.sheets]:
        sheet = book.sheets[CONFIG_SHEET_NAME]
    else:
        sheet = book.sheets.add(CONFIG_SHEET_NAME, after=book.sheets[-1])
        sheet.api.Visible = 2  # xlSheetVeryHidden — keep it out of the way of the actual report tabs
    sheet.range("A1").value = [[key, value]]


def main():
    if not OUT_PATH.exists():
        print("reports/fusion-report.xlsx doesn't exist yet — run 'python excel/write_report.py' first.")
        sys.exit(1)
    if not XLWINGS_BAS.exists():
        print(f"Could not find xlwings.bas at {XLWINGS_BAS} — check your xlwings install.")
        sys.exit(1)

    interpreter = resolve_python3()

    if xw.apps.count > 0:
        book = xw.Book(str(OUT_PATH))
        owned_app = None
    else:
        app = xw.App(visible=True)
        book = app.books.open(str(OUT_PATH))
        owned_app = app

    try:
        try:
            vb_project = book.api.VBProject
        except Exception:
            print(
                'Could not access the VBA project. In Excel: File > Options > Trust Center > '
                'Trust Center Settings > Macro Settings > check "Trust access to the VBA project '
                'object model", then re-run this script.'
            )
            sys.exit(1)

        for name in ("xlwings", MODULE_NAME):
            for component in list(vb_project.VBComponents):
                if component.Name == name:
                    vb_project.VBComponents.Remove(component)

        vb_project.VBComponents.Import(str(XLWINGS_BAS))

        module = vb_project.VBComponents.Add(1)  # 1 = vbext_ct_StdModule
        module.Name = MODULE_NAME
        module.CodeModule.AddFromString(MACRO_CODE)

        set_config(book, "INTERPRETER_WIN", interpreter)

        sheet = book.sheets[0]
        for shape in list(sheet.api.Buttons()):
            if shape.Caption == "Refresh from Fusion":
                shape.Delete()

        button = sheet.api.Buttons().Add(10, 10, 140, 28)
        button.Caption = "Refresh from Fusion"
        button.OnAction = MACRO_NAME

        book.save(str(OUT_PATH))
        print(f"Added '{MACRO_NAME}' macro and button to {OUT_PATH}.")
        print(f"Interpreter pinned to: {interpreter}")
        print('Click "Refresh from Fusion" on the PO Summary sheet to pull the latest analysis into this live workbook.')
    finally:
        if owned_app is not None:
            owned_app.quit()


if __name__ == "__main__":
    main()

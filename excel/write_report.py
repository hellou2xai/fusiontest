"""
Pushes the latest Fusion analysis reports (reports/*.json) into the Excel
workbook via xlwings — the "write TO Excel" direction of the integration.

Live-attaches if the workbook (or any Excel instance) is already open, instead
of always spawning a separate hidden process — so if you already have
fusion-report.xlsx open on screen, this writes directly into that live session
and you see it update in place, rather than opening a second invisible copy.

Runs visible by default (this is a demo moment: watching Excel populate live is
the point) — pass --hidden to suppress the window when starting a NEW Excel
instance (used by the REST export endpoint on a server host). If Excel is
already running, that instance's own visibility wins regardless of --hidden.

Usage: python excel/write_report.py [--hidden]
"""
import sys
import xlwings as xw
from report_sections import ROOT, load_latest_reports, write_all_sections

OUT_PATH = ROOT / "reports" / "fusion-report.xlsx"


def open_or_attach(hidden: bool):
    """Attach to a running Excel instance if one exists (live 2-way mode);
    otherwise start a new one with the requested visibility."""
    if xw.apps.count > 0:
        book = xw.Book(str(OUT_PATH)) if OUT_PATH.exists() else xw.books.add()
        return book, None
    app = xw.App(visible=not hidden)
    book = app.books.open(str(OUT_PATH)) if OUT_PATH.exists() else app.books.add()
    return book, app


def main():
    hidden = "--hidden" in sys.argv
    reports = load_latest_reports()

    if not any(reports.values()):
        print("No reports found in reports/ — run the CLI agents first (po:analyze, savings:analyze, payables:analyze).")
        sys.exit(1)

    book, owned_app = open_or_attach(hidden)
    try:
        write_all_sections(book, reports)

        # Drop the default blank sheet xlwings creates for a brand-new book, if unused.
        for s in list(book.sheets):
            if s.name.lower().startswith("sheet") and s.used_range.value is None:
                s.delete()

        book.sheets[0].activate()
        book.save(str(OUT_PATH))
        print(f"Wrote {OUT_PATH}")
        if owned_app is None:
            print("Updated the already-open workbook in place.")
        elif not hidden:
            print("Workbook left open for viewing.")
        else:
            book.close()
            owned_app.quit()
    except Exception:
        if owned_app is not None:
            owned_app.quit()
        raise


if __name__ == "__main__":
    main()

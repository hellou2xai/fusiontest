# fusiontest — Oracle Fusion agent tooling — progress notes

Last updated: 2026-08-21, end of session (second pass). Written for continuation on
a different machine — read this before doing anything else.

## What this project is

Agents for Oracle Fusion Cloud ERP, built against a live (shared, multi-tenant demo)
Oracle Fusion instance via its REST API. Goal stated by the user: build agent
capabilities for procurement/finance analysis, demoable as a CLI, as an MCP server
other AI assistants can call, as a live HTML dashboard, and with bidirectional Excel
integration via xlwings — with all surfaces returning identical numbers.

GitHub remote is configured (`origin` → `https://github.com/hellou2xai/fusiontest`)
and **has been pushed** — `master` is up to date on GitHub as of this session.

## Environments

Three Oracle Fusion demo pods were given, all sharing the same base seed dataset
(~17,380–17,400 total purchase orders) but at different points with different live
test traffic on top:

| Environment | User | Notes |
|---|---|---|
| `fa-etaj-saasfademo1.ds-fa.oraclepdemos.com` | Daisy.Ella | least recent activity |
| `eqjz.ds-fa.oraclepdemos.com` | Nora.Harper | mid activity |
| `fa-euth-dev49-saasfademo1.ds-fa.oraclepdemos.com` | Ross.Lester | **most activity — chosen as the working environment** |

**Credentials are intentionally not in this file.** `.env` is gitignored and does not
exist on a fresh clone/machine. To continue on a new machine:

1. `git clone` the repo, `npm install`
2. `cp .env.example .env` and fill in `FUSION_BASE_URL`, `FUSION_USERNAME`,
   `FUSION_PASSWORD` for `fa-euth-dev49-saasfademo1` / `Ross.Lester` (get these from
   wherever you're keeping them — they were provided directly in chat, not stored
   anywhere else by this session)
3. Everything else works from there — all path resolution is anchored to the project
   root (`src/paths.ts`, and `src/config.ts` resolves `.env` relative to its own file
   location), **not** to whatever directory a command happens to be launched from.
   This was a real bug fixed this session (see "Known issues fixed" below).
4. For the Excel features: `pip install xlwings` (or confirm it's already installed)
   and make sure a real Excel install is on the machine — xlwings drives Excel live
   via COM (Windows) and only works if Excel itself is installed, not just the Python
   package. **Check which `python`/`python3` on the new machine actually has xlwings**
   — this machine had two Python installs and only one had it; see "Known issues
   fixed" below, it will very likely bite you again on a different machine.

## Architecture

One principle drives the whole repo: **single source of truth, multiple surfaces.**
Each analysis is a pure function in `src/fusion/*.ts` that only knows how to talk to
Fusion's REST API and shape data. Every surface (CLI, MCP tool, REST endpoint) calls
that same function — so a CLI run, an MCP tool call, and the dashboard's `/api/*`
endpoint always return identical numbers for the same inputs. Verified explicitly
this session (7 organic POs / 20 bulk-import / $172,643.93 USD matched exactly across
CLI, MCP stdio, MCP HTTP, and REST).

```
src/
  config.ts              Loads .env (anchored to project root, not cwd)
  paths.ts               PROJECT_ROOT / REPORTS_DIR / LOGS_DIR, also anchored
  fusionClient.ts         fetchAllPages() — generic paginated Fusion REST GET helper
  fusion/
    poAnalysis.ts          Core: PO headers in a window, organic vs bulk-import split,
                            group-bys (status/supplier/buyer/BU)
    savingsAnalysis.ts      Maverick (off-contract) spend, price-variance leakage
                            (with outlier filtering), AND contract-price variance
                            (reads excel/reference-prices.xlsx via referencePrices.ts)
    poDataset.ts            Single-PO deep drill: header -> lines -> schedules ->
                            distributions (the "complete dataset" ask)
    payablesAnalysis.ts     Invoices matched to POs, paid/unpaid status
  excel/
    referencePrices.ts      Node->Python bridge: spawns excel/read_reference_prices.py,
                            parses its JSON stdout. Returns [] on any failure (Excel
                            integration is best-effort, never blocks the rest of the
                            analysis).
  agents/                 CLI entrypoints, one per analysis (thin wrappers)
    poAnalysis.ts            npm run po:analyze          (default: 30 days)
    savingsAnalysis.ts        npm run savings:analyze -- <days>   (default: 90)
    poFull.ts                 npm run po:full -- <OrderNumber>
    payablesAnalysis.ts       npm run payables:analyze -- <days>  (default: 90)
  mcp/
    registerTools.ts        MCP tool registrations — ALL FOUR analyses now exposed:
                            fusion_po_analysis, fusion_context, fusion_run_history,
                            fusion_tool_log, fusion_savings_analysis,
                            fusion_payables_analysis, fusion_po_full (7 tools total)
    stdioServer.ts           npm run mcp:stdio  — for Claude Code/Desktop
    httpServer.ts            npm run mcp:http   — serves /mcp (protocol), /api/*
                            (REST), /dashboard (HTML) all on one port (8787).
                            REST routes: /api/po-analysis, /api/savings-analysis,
                            /api/payables-analysis, /api/po-full?orderNumber=X,
                            /api/history, /api/logs, POST /api/export-excel
    logger.ts                Structured JSONL logging of every MCP tool call to
                            logs/mcp-<date>.jsonl (observability)
    history.ts               Reads persisted reports/po-analysis-*.json snapshots,
                            computes trend deltas (memory of past runs)
    public/dashboard.html   Redesigned: sidebar-nav "console" layout, sections for
                            Overview / Purchase Orders / Savings Opportunity /
                            Payables / PO Drill-down (live search by order number) /
                            Run History / Tool Log, plus an "Export to Excel" button
                            wired to POST /api/export-excel
excel/
  create_reference_template.py  Run once to seed excel/reference-prices.xlsx
  reference-prices.xlsx         The negotiated-rate reference file (NOT gitignored
                            currently — contains only example/placeholder rates
                            right now, safe to commit; replace with real rates and
                            reconsider before committing real contract data)
  read_reference_prices.py      Headless (visible=False) read, called by
                            referencePrices.ts as a subprocess
  write_report.py               Writes reports/*.json into reports/fusion-report.xlsx
                            (gitignored). Visible by default (demo moment — watching
                            Excel populate live); --hidden flag used by the REST
                            export endpoint
reports/                  Generated JSON/MD/XLSX outputs, gitignored (contains live
                          tenant data)
logs/                     MCP tool-call logs, gitignored
```

## Data model discovered on this Fusion instance (fscmRestApi 11.13.18.05)

Confirmed by direct API exploration this session:

- `purchaseOrders` (top-level, filterable by `q=CreationDate>=...`, `OrderNumber=...`)
  - `child/lines` — `Price`, `Quantity`, `Category`, `Description`, `ItemId` (mostly
    null in this seed data — services-heavy), `SourceAgreementId`/`SourceAgreementNumber`
    (contract reference)
    - `child/schedules` — **receiving and billing status live here**:
      `ReceivedAmount`, `ReceivedQuantity`, `BilledAmount`, `BilledQuantity`,
      `InvoiceMatchOption` (2-way/3-way), `DestinationType`. No separate receiving-API
      call is needed for basic received/billed visibility.
      - `child/distributions` — GL accounting: `POChargeAccount`, `POAccrualAccount`,
        `Total`
- `invoices` (top-level, Payables, filterable by `q=CreationDate>=...`) — accessible,
  362 invoices in the last 90 days on this tenant. Has `PurchaseOrderNumber` at header
  level for PO matching. Has `child/invoiceLines` (not yet explored in depth).
- `receivingTransactions` — **403 Forbidden** for this user, not accessible.
- `receivingReceipts` — exists but requires an explicit finder
  (`ShipmentHeaderId` or `ReceiptNumber`); not freely queryable by date range, so
  not useful for bulk window scans. (Not needed anyway — schedules cover it.)

## Known data-quality issues in this tenant (and how they're handled)

This is a **shared, multi-tenant Oracle demo/seed dataset**, not real procurement
history. Several filters exist specifically to keep numbers honest:

1. **Bulk-import test traffic**: buyers matching `/^IMP\d+,\s*SAAS$/i` (e.g.
   "IMP1, SAAS") are automated interface/import test runs from other users sharing
   this pod, with absurd values (single POs over $2B). Filtered out everywhere via
   `isBulkImportBuyer()` in `poAnalysis.ts` — "organic" means this filter applied.
2. **Price-variance outlier filtering** (`savingsAnalysis.ts`): even after removing
   bulk-import buyers, remaining seed data has unrelated test scenarios coincidentally
   sharing generic item descriptions ("Exhibition Fees", "Advertising") at wildly
   different price points (up to 639x spread). Groups with a max/min price ratio
   `> PRICE_RATIO_OUTLIER_THRESHOLD` (currently 5x) are split into
   `flaggedForReview` and excluded from the credible `totalLostSavingsUSD` figure.
   Verified result on 90-day window: **$2.77M credible overpayment** vs **$35.9M
   correctly excluded as noise**.
3. **Off-contract spend caveat**: `maverickSpend.offContractShare` came back ~100%
   in testing. This almost certainly means `SourceAgreementId` is never populated in
   this seed data, not that literal governance is 100% broken. `maverickSpend.note`
   carries this caveat automatically when share > 95% — **do not present this number
   without the caveat**.
4. **Payables (`payablesAnalysis.ts`) has the same noise pattern** — only 2 of 362
   invoices in the 90-day window were PO-matched, and non-PO invoice totals ($64.5M)
   are likely inflated by the same synthetic-data phenomenon as maverick spend. **No
   outlier filter has been added here yet** — treat the raw payables dollar totals as
   directional only, not demo-ready numbers, until this is addressed (see Next Steps).
5. **Contract-price variance (Excel-derived) is only independent when the reference
   prices are real.** `excel/populate_reference_from_savings.py` fills
   `reference-prices.xlsx` with real, non-fabricated data — but the *only* real data
   available for this is "the lowest price already paid for this item," pulled from
   the same outlier-filtered `groupsWithVariance` used by the price-variance check.
   That makes it **mathematically identical** to price-variance when run this way —
   verified: both came back as exactly $2,765,868.00 on the same run.
   `contractVariance.derivedFromInternalData` and `.note` flag this automatically,
   surfaced in the CLI/dashboard/Excel export. **Superseded as the primary signal**
   by agreement-price variance below — kept as a secondary check.
6. **Agreement-price variance is the real fix — genuinely independent, verified.**
   `src/fusion/agreementPrices.ts` queries Oracle Fusion Procurement's own
   `purchaseAgreementLines` (Blanket + Contract Purchase Agreements, 4,959 open
   lines on this tenant) and matches by `ItemId` first, `Description`+`UOM`+
   `Currency` as fallback. This was built in direct response to the user asking
   "did you check the blanket agreement... that's the best way to find on Oracle
   Fusion" — they were right, and this is the correct mechanism, not a workaround.
   Verified result on the 90-day window: 8 of 4,959 agreement lines matched an
   organic PO line; only 1 was actually priced above the agreement rate —
   **$13.00 overpaid** (`SU617153`, "Belt Ware Sensor", agreement 27339). Small
   because this tenant's agreements mostly cover catalog goods while the earlier
   price-variance findings were free-text services with no `ItemId` — but this is
   the one number in the whole savings analysis that needs **zero caveats**: it's
   real Oracle data compared to real Oracle data, no derivation, no fabrication.
   `agreementVariance.note` explains the low match count when it happens (it isn't
   a bug). **This should be the headline signal in any demo**, with price-variance
   and contract-variance kept as supporting/exploratory signals underneath it.

**Do not fabricate negotiated rates to make this look more independent.** If asked
to "put in real rates," check `purchaseAgreementLines` first (see above) — that's
the actual authoritative source. Only fall back to Excel-derived/internal data when
no real coverage exists, and always with the caveat. Inventing
plausible numbers was explicitly rejected this session in favor of (a).

## What's built and verified working (this session)

- ✅ `npm run po:analyze` — 30-day PO analysis, writes `reports/po-analysis-<date>.{json,md}`
- ✅ `npm run savings:analyze -- 90` — maverick spend + price-variance (with outlier
  filtering) + contract-price variance (Excel-backed). Tested end to end on live data.
- ✅ `npm run po:full -- <OrderNumber>` — complete document-flow drill for one PO
  (header → lines → schedules → distributions). Tested on `SU617111` (24 lines).
- ✅ `npm run payables:analyze -- 90` — invoice-to-PO matching. Tested end to end.
- ✅ `npm run mcp:stdio` — MCP server over stdio, **7 tools** registered (all four
  analyses) — smoke-tested via manual JSON-RPC (initialize + tools/list + tools/call).
- ✅ `npm run mcp:http` — same 7 tools over HTTP (`/mcp`), plus REST endpoints for
  every analysis and the live dashboard (`/dashboard`). Verified CLI/MCP/REST all
  return identical numbers for the same inputs.
- ✅ MCP tool-call observability: every call logged to `logs/mcp-<date>.jsonl`
  (tool, args, duration, status, record count), surfaced via `fusion_tool_log` and
  the dashboard's log panel.
- ✅ MCP "memory": `fusion_run_history` reads persisted `reports/po-analysis-*.json`
  snapshots and diffs the two most recent.
- ✅ **Excel integration (xlwings), both directions, verified working:**
  - Read: `excel/reference-prices.xlsx` → `read_reference_prices.py` →
    `referencePrices.ts` → feeds `savingsAnalysis.ts`'s contract-variance check.
    Confirmed: 3 reference prices loaded, $1.7M overpayment found.
  - Write: `write_report.py` pushes the latest `reports/*.json` into a formatted,
    live `reports/fusion-report.xlsx` (PO Summary / Savings Opportunity incl.
    contract variance / Payables sheets, bold headers, currency formatting,
    autofit). Runs visible by default (the demo moment) or `--hidden` for the
    REST endpoint. Confirmed contents match the JSON source via a read-back check.
  - REST: `POST /api/export-excel` triggers the hidden write, wired to the
    dashboard's "Export to Excel" button.
- ✅ **Dashboard redesigned**: sidebar-nav "console" layout (not single-column
  scroll), sections for every analysis, live PO drill-down search box, Excel export
  button. Not yet visually verified in an actual browser by this session — REST
  endpoints it depends on were all individually curl-tested and confirmed working,
  but nobody has looked at the rendered page.
- ✅ Published dashboard Artifact (one-off, point-in-time, from *before* this second
  pass): `https://claude.ai/code/artifact/a67b212f-adff-4383-97a3-0466319e14a0` —
  static and now out of date; the live one is at `/dashboard`.

## Known issues fixed this session

- **Path resolution bug**: `reports/` and `logs/` were resolved relative to
  `process.cwd()`, which broke when the CLI was run from outside the project
  directory (e.g. via a user-scoped MCP registration). Fixed by anchoring all paths
  to the project root via `src/paths.ts` and fixing `.env` loading in `config.ts` the
  same way. **Verified fixed** by running `po:analyze` from `/tmp`.
- **MCP HTTP stateless-mode bug**: originally created one `StreamableHTTPServerTransport`
  at server startup and reused it for every request — broke on the second request
  (500 error). Fixed by creating a fresh transport + MCP server per request, per the
  SDK's documented stateless pattern (`src/mcp/httpServer.ts`).
- **Wrong Python resolved for xlwings**: this machine has two Python installs —
  plain `python` resolves to 3.12 (no xlwings), `python3` resolves to 3.13 (has
  xlwings). Both `referencePrices.ts` and the `/api/export-excel` route in
  `httpServer.ts` originally called `spawn("python", ...)` and silently got the
  wrong interpreter (contract-variance came back empty with a swallowed
  `ModuleNotFoundError` in stderr). Fixed by hardcoding `python3` in both spawn
  calls. **On a new machine, check this again** — the working interpreter name may
  be different there (`python`, `python3`, or a full path); grep for
  `spawn("python3"` in `src/` and adjust if `python3 -c "import xlwings"` fails.

## MCP registration status

- **Project scope** (`.mcp.json`, committed to repo): present, but requires
  interactive approval via `/mcp` in each new Claude Code session on each machine —
  this was repeatedly dismissed rather than approved during this session and never
  actually got approved. If you hit "no MCP tools available" on the new machine, this
  is almost certainly why — run `/mcp` and actually select approve, not dismiss/Esc.
- **User scope** (this machine only, not portable): registered via
  `claude mcp add fusion-agents -s user -- npx tsx C:/Sambit/fusiontest/src/mcp/stdioServer.ts`
  and confirmed "✔ Connected". **This will need to be re-run on the new machine** with
  the correct absolute path for that machine, since user-scope config lives in
  `~/.claude.json` on this machine, not in the repo.
- There's a known harmless scope-conflict warning when both exist simultaneously
  (`claude mcp list` will mention it) — not a real problem, just informational.

## Demo ideas discussed (not yet built)

- Everything built so far is **read-only** against Fusion (Excel write is the one
  exception — that's a presentation layer, not a Fusion mutation). The user asked
  about a "mindblowing demo" — recommendation given was: live natural-language
  queries against real Fusion data (works today) as the baseline wow, with a
  **guarded write-back tool** (e.g. flag/comment/approve a PO, with dry-run +
  explicit confirm since this is a shared tenant) as the actual differentiator. Not
  started.

## Next steps (prioritized)

1. **Widen agreement-price variance coverage.** It's the one fully-independent,
   caveat-free signal (see above), but only matched 8 of 3,384 organic lines on a
   90-day window because this tenant's agreements are goods-heavy and organic spend
   was services-heavy. Try a longer window (1 year — see below), and/or check
   whether Fusion has a services-category agreement type not yet queried.
2. Excel-derived contract-price variance (`excel/reference-prices.xlsx`) is now
   secondary. Real negotiated rates would still make it independent, but
   agreement-price variance is the better investment of effort going forward.
3. **Visually QA the redesigned dashboard in an actual browser.** It was built and
   every REST endpoint it calls was individually curl-tested, but nobody has loaded
   `http://localhost:8787/dashboard` and looked at it — check the sidebar layout,
   the PO drill-down search, and the Export to Excel button actually work end to
   end from the UI, not just via curl.
4. **Add outlier/sanity filtering to `payablesAnalysis.ts`**, mirroring what
   `savingsAnalysis.ts` already does — the raw non-PO invoice totals are currently
   not demo-credible for the same reason the pre-fix savings numbers weren't.
5. **Resolve MCP project-scope approval** on whatever machine is used next — see
   "MCP registration status" above.
6. **Consider tightening price-variance grouping** (e.g. add Supplier to the group
   key, not just Description+UOM) if the current 5x-ratio outlier filter alone isn't
   convincing enough for a live audience — discussed but not implemented.
7. **Write-back capability** for the "mindblowing demo" upgrade — not started, needs
   explicit scoping (which action, what guardrails) before building.

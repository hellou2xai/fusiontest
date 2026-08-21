# fusiontest — Oracle Fusion agent tooling — progress notes

Last updated: 2026-08-21, end of session. Written for continuation on a different
machine — read this before doing anything else.

## What this project is

Agents for Oracle Fusion Cloud ERP, built against a live (shared, multi-tenant demo)
Oracle Fusion instance via its REST API. Goal stated by the user: build agent
capabilities for procurement/finance analysis, demoable both as a CLI, as an MCP
server other AI assistants can call, and as a live HTML dashboard — and have all
three surfaces return identical numbers.

GitHub remote is configured (`origin` → `https://github.com/hellou2xai/fusiontest`)
but **nothing has been pushed yet** — only local commits on `master`. Push explicitly
if you want it on GitHub.

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
    savingsAnalysis.ts      Maverick (off-contract) spend + price-variance leakage,
                            with outlier filtering (see below)
    poDataset.ts            Single-PO deep drill: header -> lines -> schedules ->
                            distributions (the "complete dataset" ask)
    payablesAnalysis.ts     Invoices matched to POs, paid/unpaid status
  agents/                 CLI entrypoints, one per analysis (thin wrappers)
    poAnalysis.ts            npm run po:analyze          (default: 30 days)
    savingsAnalysis.ts        npm run savings:analyze -- <days>   (default: 90)
    poFull.ts                 npm run po:full -- <OrderNumber>
    payablesAnalysis.ts       npm run payables:analyze -- <days>  (default: 90)
  mcp/
    registerTools.ts        MCP tool registrations — ONLY wraps poAnalysis.ts today
                            (fusion_po_analysis, fusion_context, fusion_run_history,
                            fusion_tool_log). savingsAnalysis/poDataset/payables are
                            NOT yet exposed as MCP tools — see Next Steps.
    stdioServer.ts           npm run mcp:stdio  — for Claude Code/Desktop
    httpServer.ts            npm run mcp:http   — serves /mcp (protocol), /api/*
                            (REST), /dashboard (HTML) all on one port (8787)
    logger.ts                Structured JSONL logging of every MCP tool call to
                            logs/mcp-<date>.jsonl (observability)
    history.ts               Reads persisted reports/po-analysis-*.json snapshots,
                            computes trend deltas (memory of past runs)
    public/dashboard.html   Live-fetching dashboard, polls /api/* every 30s
reports/                  Generated JSON/MD outputs, gitignored (contains live
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

## What's built and verified working (this session)

- ✅ `npm run po:analyze` — 30-day PO analysis, writes `reports/po-analysis-<date>.{json,md}`
- ✅ `npm run savings:analyze -- 90` — maverick spend + price-variance, with outlier
  filtering. Tested end to end on live data.
- ✅ `npm run po:full -- <OrderNumber>` — complete document-flow drill for one PO
  (header → lines → schedules → distributions). Tested on `SU617111` (24 lines).
- ✅ `npm run payables:analyze -- 90` — invoice-to-PO matching. Tested end to end.
- ✅ `npm run mcp:stdio` — MCP server over stdio, 4 tools registered and verified via
  a manual JSON-RPC smoke test (initialize + tools/list + tools/call all confirmed).
- ✅ `npm run mcp:http` — same 4 tools over HTTP (`/mcp`), plus REST (`/api/po-analysis`,
  `/api/history`, `/api/logs`) and the live dashboard (`/dashboard`). Verified all
  three protocols return identical numbers.
- ✅ MCP tool-call observability: every call logged to `logs/mcp-<date>.jsonl`
  (tool, args, duration, status, record count), surfaced via `fusion_tool_log` and
  the dashboard's log panel.
- ✅ MCP "memory": `fusion_run_history` reads persisted `reports/po-analysis-*.json`
  snapshots and diffs the two most recent.
- ✅ Published dashboard Artifact (one-off, point-in-time):
  `https://claude.ai/code/artifact/a67b212f-adff-4383-97a3-0466319e14a0` — this is
  static, not the live one at `/dashboard`.

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

- The dashboard/CLI/MCP tools built so far are all **read-only**. The user asked
  about a "mindblowing demo" — recommendation given was: live natural-language
  queries against real Fusion data (works today) as the baseline wow, with a
  **guarded write-back tool** (e.g. flag/comment/approve a PO, with dry-run +
  explicit confirm since this is a shared tenant) as the actual differentiator. Not
  started.

## Next steps (prioritized)

1. **Wire `savingsAnalysis`, `poDataset`, `payablesAnalysis` into MCP + dashboard.**
   Only `poAnalysis` is exposed as MCP tools / dashboard panels today. The other
   three exist as solid, tested CLI-only capabilities — same "single source of
   truth, multiple surfaces" pattern should be applied to them (add
   `registerTool` entries in `src/mcp/registerTools.ts`, REST routes in
   `httpServer.ts`, dashboard panels).
2. **Add outlier/sanity filtering to `payablesAnalysis.ts`**, mirroring what
   `savingsAnalysis.ts` already does — the raw non-PO invoice totals are currently
   not demo-credible for the same reason the pre-fix savings numbers weren't.
3. **Resolve MCP project-scope approval** on whatever machine is used next — see
   "MCP registration status" above.
4. **Consider tightening price-variance grouping** (e.g. add Supplier to the group
   key, not just Description+UOM) if the current 5x-ratio outlier filter alone isn't
   convincing enough for a live audience — this was discussed as an alternative/
   additional fix but not implemented (outlier filtering alone was chosen).
5. **Write-back capability** for the "mindblowing demo" upgrade — not started, needs
   explicit scoping (which action, what guardrails) before building.
6. Nothing has been pushed to GitHub yet — decide if/when to `git push`.

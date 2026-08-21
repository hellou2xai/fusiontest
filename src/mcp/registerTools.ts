import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPoAnalysis } from "../fusion/poAnalysis.js";
import { getTrend } from "./history.js";
import { readRecentLogs, withLogging } from "./logger.js";
import { config } from "../config.js";

/**
 * Single place where every Fusion "capability" is registered as an MCP tool.
 * The CLI, this MCP server (stdio + HTTP), and the local web dashboard's REST
 * endpoints all call the same underlying functions (runPoAnalysis / getTrend /
 * readRecentLogs) — this file is just the MCP-protocol wrapper around them, so
 * every surface returns identical numbers.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "fusion-agents", version: "0.1.0" });

  const poAnalysisLogged = withLogging(
    "fusion_po_analysis",
    async (args: { days?: number }) => runPoAnalysis(args.days ?? 30),
    (r) => r.totalPurchaseOrders
  );

  server.registerTool(
    "fusion_po_analysis",
    {
      title: "Oracle Fusion PO Analysis",
      description:
        "Analyzes purchase orders created in the last N days on the configured Oracle Fusion ERP environment. " +
        "Automatically separates bulk-import/interface test rows (buyers matching IMP*, SAAS) from organic procurement " +
        "activity, and reports totals, spend by currency, and breakdowns by status, supplier, buyer, and business unit.",
      inputSchema: { days: z.number().int().min(1).max(365).optional().describe("Lookback window in days (default 30)") },
    },
    async (args) => {
      const result = await poAnalysisLogged(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  const contextLogged = withLogging(
    "fusion_context",
    async (args: { days?: number }) => {
      const result = await runPoAnalysis(args.days ?? 30);
      return {
        environment: { baseUrl: config.baseUrl, restVersion: config.restVersion },
        businessUnits: result.byProcurementBU.map((g) => g.key),
        suppliers: result.bySupplier.map((g) => g.key),
        buyers: result.byBuyer.map((g) => g.key),
        statuses: result.byStatus.map((g) => g.key),
      };
    },
    (r) => r.businessUnits.length + r.suppliers.length + r.buyers.length
  );

  server.registerTool(
    "fusion_context",
    {
      title: "Oracle Fusion Business Context",
      description:
        "Returns reference/business-context values derived from recent organic purchase order activity: known " +
        "business units, suppliers, buyers, and status values, plus which Fusion environment is configured. Use this " +
        "to ground follow-up queries before running deeper analysis.",
      inputSchema: { days: z.number().int().min(1).max(365).optional().describe("Lookback window in days (default 30)") },
    },
    async (args) => {
      const result = await contextLogged(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  const historyLogged = withLogging("fusion_run_history", async () => getTrend(), (r) => r.snapshots.length);

  server.registerTool(
    "fusion_run_history",
    {
      title: "Fusion Agent Run History",
      description:
        "Returns the history of previously persisted PO analysis snapshots (memory of the agent's own past runs) " +
        "plus a trend comparison between the two most recent runs — how organic PO count and USD spend changed.",
      inputSchema: {},
    },
    async () => {
      const result = await historyLogged({});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  const logsLogged = withLogging(
    "fusion_tool_log",
    async (args: { limit?: number }) => readRecentLogs(args.limit ?? 50),
    (r) => r.length
  );

  server.registerTool(
    "fusion_tool_log",
    {
      title: "MCP Tool Call Log",
      description:
        "Observability tool: returns the most recent MCP tool calls made against this server (which tool, arguments, " +
        "duration, success/failure) so a client can audit what the agent has been doing.",
      inputSchema: { limit: z.number().int().min(1).max(500).optional().describe("Max entries to return (default 50)") },
    },
    async (args) => {
      const result = await logsLogged(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

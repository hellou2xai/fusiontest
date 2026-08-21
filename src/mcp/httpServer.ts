import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "./registerTools.js";
import { runPoAnalysis } from "../fusion/poAnalysis.js";
import { runSavingsAnalysis } from "../fusion/savingsAnalysis.js";
import { runPayablesAnalysis } from "../fusion/payablesAnalysis.js";
import { fetchCompletePoDataset } from "../fusion/poDataset.js";
import { getTrend } from "./history.js";
import { readRecentLogs } from "./logger.js";
import { config } from "../config.js";
import { PROJECT_ROOT } from "../paths.js";

const PORT = Number(process.env.MCP_HTTP_PORT ?? 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = path.join(__dirname, "public", "dashboard.html");

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

function daysParam(url: URL): number | undefined {
  const raw = url.searchParams.get("days");
  return raw ? Number(raw) : undefined;
}

async function main() {
  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    try {
      if (url.pathname === "/mcp") {
        // Stateless mode: a fresh server + transport per request, torn down once the
        // response closes, per the SDK's documented stateless pattern.
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          transport.close();
          mcpServer.close();
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      if (url.pathname === "/health") {
        sendJson(res, 200, { status: "ok", environment: config.baseUrl });
        return;
      }

      if (url.pathname === "/api/po-analysis") {
        const result = await runPoAnalysis(daysParam(url) ?? 30);
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/api/history") {
        const result = await getTrend();
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/api/logs") {
        const limit = url.searchParams.get("limit");
        const result = await readRecentLogs(limit ? Number(limit) : 50);
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/api/savings-analysis") {
        const result = await runSavingsAnalysis(daysParam(url) ?? 90);
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/api/payables-analysis") {
        const result = await runPayablesAnalysis(daysParam(url) ?? 90);
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/api/po-full") {
        const orderNumber = url.searchParams.get("orderNumber");
        if (!orderNumber) {
          sendJson(res, 400, { error: "orderNumber query param is required" });
          return;
        }
        const result = await fetchCompletePoDataset(orderNumber);
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === "/api/export-excel" && req.method === "POST") {
        const scriptPath = path.join(PROJECT_ROOT, "excel", "write_report.py");
        const proc = spawn("python3", [scriptPath, "--hidden"], { cwd: PROJECT_ROOT });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (c) => (stdout += c));
        proc.stderr.on("data", (c) => (stderr += c));
        proc.on("close", (code) => {
          if (code === 0) {
            sendJson(res, 200, { status: "ok", message: stdout.trim() });
          } else {
            sendJson(res, 500, { status: "error", message: stderr.trim() || "Excel export failed" });
          }
        });
        proc.on("error", (err) => {
          sendJson(res, 500, { status: "error", message: err.message });
        });
        return;
      }

      if (url.pathname === "/" || url.pathname === "/dashboard") {
        const html = await readFile(DASHBOARD_PATH, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      console.error(`[${url.pathname}]`, err);
      if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`Fusion MCP HTTP server listening on http://localhost:${PORT}`);
    console.log(`  MCP endpoint:   http://localhost:${PORT}/mcp`);
    console.log(`  Dashboard:      http://localhost:${PORT}/dashboard`);
    console.log(`  REST API:       /api/po-analysis?days=30, /api/history, /api/logs`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

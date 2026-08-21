import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve .env relative to the project root (this file's location), not process.cwd(),
// so the server works when launched from anywhere (e.g. a user-scoped MCP registration).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  baseUrl: required("FUSION_BASE_URL").replace(/\/+$/, ""),
  username: required("FUSION_USERNAME"),
  password: required("FUSION_PASSWORD"),
  restVersion: process.env.FUSION_REST_VERSION ?? "11.13.18.05",
};

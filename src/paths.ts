import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.join(__dirname, "..");
export const REPORTS_DIR = path.join(PROJECT_ROOT, "reports");
export const LOGS_DIR = path.join(PROJECT_ROOT, "logs");

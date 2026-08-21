import "dotenv/config";

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

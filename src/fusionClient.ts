import { config } from "./config.js";

const authHeader = "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");

export interface FusionPage<T> {
  items: T[];
  totalResults: number;
  count: number;
  hasMore: boolean;
}

/**
 * Fetches all pages of a Fusion REST collection resource, following offset-based pagination.
 */
export async function fetchAllPages<T>(
  resourcePath: string,
  query: Record<string, string>,
  pageLimit = 200
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      ...query,
      onlyData: "true",
      totalResults: "true",
      limit: String(pageLimit),
      offset: String(offset),
    });

    const url = `${config.baseUrl}/fscmRestApi/resources/${config.restVersion}/${resourcePath}?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Fusion REST call failed (${res.status} ${res.statusText}): ${url}`);
    }

    const page = (await res.json()) as FusionPage<T>;
    items.push(...page.items);

    if (!page.hasMore) break;
    offset += page.items.length;
  }

  return items;
}

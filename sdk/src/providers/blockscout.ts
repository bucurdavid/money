/**
 * providers/blockscout.ts — Blockscout EVM token discovery provider
 *
 * Fetches ERC-20 token balances from Blockscout's free v2 API (no API key needed).
 * API docs: https://docs.blockscout.com/devs/apis/rest-api
 */

/** Chain → Blockscout hostname mapping (only chains confirmed working) */
export const BLOCKSCOUT_HOSTS: Record<string, string> = {
  ethereum: 'eth.blockscout.com',
  base: 'base.blockscout.com',
  arbitrum: 'arbitrum.blockscout.com',
  optimism: 'optimism.blockscout.com',
  zksync: 'zksync.blockscout.com',
  scroll: 'scroll.blockscout.com',
};

/** Raw shape of a single item in the Blockscout v2 tokens response */
interface BlockscoutTokenItem {
  token: {
    address_hash: string;
    decimals: string | null;
    name: string | null;
    symbol: string | null;
    type: string;
  };
  value: string;
}

/** Raw shape of the Blockscout v2 tokens response page */
interface BlockscoutTokensResponse {
  items: BlockscoutTokenItem[];
  next_page_params: {
    id: number;
    value: string;
    fiat_value: string;
    items_count: number;
  } | null;
}

/**
 * Convert a raw decimal balance string to a human-readable string.
 * Uses BigInt arithmetic to avoid floating-point precision loss.
 */
export function formatRawBalance(value: string, decimals: number): string {
  if (decimals === 0) return value;
  const raw = BigInt(value);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  if (remainder === 0n) return whole.toString();
  const fracStr = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

/**
 * Fetch all ERC-20 token balances for an address on a supported chain via Blockscout.
 *
 * Returns an array of token entries with human-readable balances. Returns an empty
 * array if the chain is not supported or if any network/parse error occurs.
 *
 * @param chain   - Chain name (e.g. "base", "ethereum")
 * @param address - EVM address to query (0x-prefixed)
 */
export async function fetchBlockscoutTokens(
  chain: string,
  address: string,
): Promise<Array<{ symbol: string; address: string; balance: string; rawBalance: string; decimals: number }>> {
  const host = BLOCKSCOUT_HOSTS[chain];
  if (!host) return [];

  const results: Array<{ symbol: string; address: string; balance: string; rawBalance: string; decimals: number }> = [];

  try {
    let url: string | null =
      `https://${host}/api/v2/addresses/${address}/tokens?type=ERC-20`;
    let pagesLeft = 4;

    while (url !== null && pagesLeft > 0) {
      pagesLeft -= 1;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      let data: BlockscoutTokensResponse;
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return results;
        data = (await res.json()) as BlockscoutTokensResponse;
      } catch {
        clearTimeout(timeoutId);
        return results;
      }

      for (const item of data.items) {
        const { token, value } = item;
        if (token.decimals === null || token.symbol === null) continue;

        const decimals = Number(token.decimals);
        const balance = formatRawBalance(value, decimals);

        results.push({
          symbol: token.symbol,
          address: token.address_hash,
          balance,
          rawBalance: value,
          decimals,
        });
      }

      if (data.next_page_params === null) {
        url = null;
      } else {
        const p = data.next_page_params;
        url =
          `https://${host}/api/v2/addresses/${address}/tokens?type=ERC-20` +
          `&id=${p.id}&value=${encodeURIComponent(p.value)}` +
          `&fiat_value=${encodeURIComponent(p.fiat_value)}` +
          `&items_count=${p.items_count}`;
      }
    }
  } catch {
    // Return whatever we collected so far on unexpected errors
    return results;
  }

  return results;
}

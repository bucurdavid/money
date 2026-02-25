/**
 * providers/dexscreener.ts — DexScreener price and token info provider
 *
 * API docs: https://docs.dexscreener.com/api/reference
 * No API key required. Rate limit: 60-300 req/min.
 */

import type { PriceProvider } from './types.js';

const BASE_URL = 'https://api.dexscreener.com';

/** DexScreener chain ID mapping (DexScreener uses lowercase names) */
const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon',
  optimism: 'optimism',
  bsc: 'bsc',
  avalanche: 'avalanche',
  fantom: 'fantom',
  zksync: 'zksync',
  linea: 'linea',
  scroll: 'scroll',
  solana: 'solana',
};

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string | null;
  txns: {
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
  };
  priceChange: {
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  } | null;
  fdv: number | null;
  marketCap: number | null;
}

export const dexscreenerProvider: PriceProvider = {
  name: 'dexscreener',
  chains: [
    'ethereum', 'base', 'arbitrum', 'polygon', 'optimism',
    'bsc', 'avalanche', 'fantom', 'zksync', 'linea', 'scroll', 'solana',
  ],

  async getPrice(params) {
    const pairs = await searchPairs(params.token, params.chain);
    if (pairs.length === 0) {
      throw new Error(
        `No price data found for "${params.token}"${params.chain ? ` on ${params.chain}` : ''}`,
      );
    }

    const best = pairs[0]!;
    return {
      price: best.priceUsd ?? '0',
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      priceChange24h:
        best.priceChange?.h24 != null ? String(best.priceChange.h24) : undefined,
      volume24h: best.volume?.h24 != null ? String(best.volume.h24) : undefined,
      liquidity: best.liquidity?.usd != null ? String(best.liquidity.usd) : undefined,
      marketCap: best.marketCap != null ? String(best.marketCap) : undefined,
    };
  },

  async getTokenInfo(params) {
    const pairs = await searchPairs(params.token, params.chain);
    if (pairs.length === 0) {
      throw new Error(
        `No token info found for "${params.token}"${params.chain ? ` on ${params.chain}` : ''}`,
      );
    }

    const best = pairs[0]!;
    return {
      name: best.baseToken.name,
      symbol: best.baseToken.symbol,
      address: best.baseToken.address,
      price: best.priceUsd ?? '0',
      priceChange24h:
        best.priceChange?.h24 != null ? String(best.priceChange.h24) : undefined,
      volume24h: best.volume?.h24 != null ? String(best.volume.h24) : undefined,
      liquidity: best.liquidity?.usd != null ? String(best.liquidity.usd) : undefined,
      marketCap: best.marketCap != null ? String(best.marketCap) : undefined,
      pairs: pairs.slice(0, 5).map((p) => ({
        dex: p.dexId,
        pairAddress: p.pairAddress,
        quoteToken: p.quoteToken.symbol,
        price: p.priceUsd ?? '0',
      })),
    };
  },
};

/**
 * Search DexScreener for pairs matching a token.
 * If chain is provided, filters results to that chain.
 */
async function searchPairs(token: string, chain?: string): Promise<DexScreenerPair[]> {
  // If token looks like an address, use the tokens endpoint
  const isAddress =
    token.startsWith('0x') || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token);

  let url: string;
  if (isAddress && chain) {
    const dsChain = CHAIN_MAP[chain] ?? chain;
    url = `${BASE_URL}/tokens/v1/${dsChain}/${token}`;
  } else {
    url = `${BASE_URL}/latest/dex/search?q=${encodeURIComponent(token)}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DexScreener request failed (${res.status})`);
  }

  const data = (await res.json()) as
    | { pairs?: DexScreenerPair[] }
    | DexScreenerPair[];
  let pairs: DexScreenerPair[];

  if (Array.isArray(data)) {
    pairs = data;
  } else {
    pairs = data.pairs ?? [];
  }

  // Filter by chain if specified
  if (chain) {
    const dsChain = CHAIN_MAP[chain] ?? chain;
    pairs = pairs.filter((p) => p.chainId === dsChain);
  }

  // Sort by liquidity (highest first)
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

  return pairs;
}

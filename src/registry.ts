/**
 * registry.ts — Adapter creation, caching, and lifecycle management
 */

import { getChainConfig } from './config.js';
import { parseConfigKey } from './defaults.js';
import { MoneyError } from './errors.js';
import { createFastAdapter } from './adapters/fast.js';
import { createEvmAdapter } from './adapters/evm.js';
import { createSolanaAdapter } from './adapters/solana.js';
import type { ChainAdapter } from './adapters/adapter.js';
import type { NetworkType } from './types.js';

// ─── Adapter registry ─────────────────────────────────────────────────────────

const adapterCache = new Map<string, ChainAdapter>();

/** EVM chain names — they share the same adapter type */
const EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

/** EVM explorer URLs by chain and network */
const EVM_EXPLORER_URLS: Record<string, Record<string, string>> = {
  base: {
    testnet: 'https://sepolia.basescan.org',
    sepolia: 'https://sepolia.basescan.org',
    mainnet: 'https://basescan.org',
  },
  ethereum: {
    testnet: 'https://sepolia.etherscan.io',
    sepolia: 'https://sepolia.etherscan.io',
    mainnet: 'https://etherscan.io',
  },
  arbitrum: {
    testnet: 'https://sepolia.arbiscan.io',
    sepolia: 'https://sepolia.arbiscan.io',
    mainnet: 'https://arbiscan.io',
  },
};

/**
 * Clear the adapter cache. Useful for testing to ensure fresh adapter instances.
 * In production, prefer money.setup() which evicts a single chain's cache entry.
 */
export function _resetAdapterCache(): void {
  adapterCache.clear();
}

/**
 * Evict a single config key from the adapter cache.
 */
export function evictAdapter(cacheKey: string): void {
  adapterCache.delete(cacheKey);
}

/**
 * Lazily create and cache a ChainAdapter for the given config key.
 * The configKey is either "chain" (testnet) or "chain:mainnet".
 * Throws if the chain is not configured or not yet supported.
 */
export async function getAdapter(cacheKey: string): Promise<ChainAdapter> {
  if (adapterCache.has(cacheKey)) {
    return adapterCache.get(cacheKey)!;
  }

  const chainConfig = await getChainConfig(cacheKey);
  if (!chainConfig) {
    const { chain } = parseConfigKey(cacheKey);
    throw new MoneyError('CHAIN_NOT_CONFIGURED',
      `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`,
      { chain },
    );
  }

  const { chain, network } = parseConfigKey(cacheKey);
  let adapter: ChainAdapter;

  if (chain === 'fast') {
    adapter = createFastAdapter(chainConfig.rpc, network);
  } else if (EVM_CHAINS.includes(chain)) {
    const explorerUrl = EVM_EXPLORER_URLS[chain]?.[chainConfig.network] ?? EVM_EXPLORER_URLS[chain]?.['testnet'] ?? '';
    const tokens: Record<string, { address: string; decimals: number }> = {};
    if (chainConfig.tokens) {
      for (const [name, tc] of Object.entries(chainConfig.tokens)) {
        if (tc.address) tokens[name] = { address: tc.address, decimals: tc.decimals ?? 6 };
      }
    }
    adapter = createEvmAdapter(chain, chainConfig.rpc, explorerUrl, tokens);
  } else if (chain === 'solana') {
    const tokens: Record<string, { mint: string; decimals: number }> = {};
    if (chainConfig.tokens) {
      for (const [name, tc] of Object.entries(chainConfig.tokens)) {
        if (tc.mint) tokens[name] = { mint: tc.mint, decimals: tc.decimals ?? 6 };
      }
    }
    adapter = createSolanaAdapter(chainConfig.rpc, tokens, network);
  } else {
    throw new Error(`Unknown chain "${chain}".`);
  }

  adapterCache.set(cacheKey, adapter);
  return adapter;
}

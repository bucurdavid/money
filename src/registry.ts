/**
 * registry.ts — Adapter creation, caching, and lifecycle management
 */

import { getChainConfig } from './config.js';
import { MoneyError } from './errors.js';
import { createFastAdapter } from './adapters/fast.js';
import { createEvmAdapter } from './adapters/evm.js';
import { createSolanaAdapter } from './adapters/solana.js';
import type { ChainAdapter } from './adapters/adapter.js';

// ─── Adapter registry ─────────────────────────────────────────────────────────

const adapterCache = new Map<string, ChainAdapter>();

/** EVM chain names — they share the same adapter type */
const EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

/**
 * Clear the adapter cache. Useful for testing to ensure fresh adapter instances.
 * In production, prefer money.setup() which evicts a single chain's cache entry.
 */
export function _resetAdapterCache(): void {
  adapterCache.clear();
}

/**
 * Evict a single chain from the adapter cache.
 */
export function evictAdapter(chain: string): void {
  adapterCache.delete(chain);
}

/**
 * Lazily create and cache a ChainAdapter for the given chain.
 * Throws if the chain is not configured or not yet supported.
 */
export async function getAdapter(chain: string): Promise<ChainAdapter> {
  if (adapterCache.has(chain)) {
    return adapterCache.get(chain)!;
  }

  const chainConfig = await getChainConfig(chain);
  if (!chainConfig) {
    throw new MoneyError('CHAIN_NOT_CONFIGURED',
      `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`,
      { chain },
    );
  }

  let adapter: ChainAdapter;

  if (chain === 'fast') {
    adapter = createFastAdapter(chainConfig.rpc);
  } else if (EVM_CHAINS.includes(chain)) {
    const explorerUrls: Record<string, string> = {
      base: 'https://sepolia.basescan.org',
      ethereum: 'https://sepolia.etherscan.io',
      arbitrum: 'https://sepolia.arbiscan.io',
    };
    const tokens: Record<string, { address: string; decimals: number }> = {};
    if (chainConfig.tokens) {
      for (const [name, tc] of Object.entries(chainConfig.tokens)) {
        if (tc.address) tokens[name] = { address: tc.address, decimals: tc.decimals ?? 6 };
      }
    }
    adapter = createEvmAdapter(chain, chainConfig.rpc, explorerUrls[chain] ?? '', tokens);
  } else if (chain === 'solana') {
    const tokens: Record<string, { mint: string; decimals: number }> = {};
    if (chainConfig.tokens) {
      for (const [name, tc] of Object.entries(chainConfig.tokens)) {
        if (tc.mint) tokens[name] = { mint: tc.mint, decimals: tc.decimals ?? 6 };
      }
    }
    adapter = createSolanaAdapter(chainConfig.rpc, tokens);
  } else {
    throw new Error(`Unknown chain "${chain}".`);
  }

  adapterCache.set(chain, adapter);
  return adapter;
}

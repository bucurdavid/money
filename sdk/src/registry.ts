/**
 * registry.ts — Adapter creation, caching, and lifecycle management
 */

import { getChainConfig } from './config.js';
import { parseConfigKey } from './defaults.js';
import { MoneyError } from './errors.js';
import { getEvmAliases, getSolanaAliases } from './aliases.js';
import { createFastAdapter } from './adapters/fast.js';
import { createEvmAdapter } from './adapters/evm.js';
import { createSolanaAdapter } from './adapters/solana.js';
import type { ChainAdapter } from './adapters/adapter.js';
import type { Chain } from 'viem';
import { baseSepolia, base, sepolia, mainnet, arbitrumSepolia, arbitrum } from 'viem/chains';

// ─── Adapter registry ─────────────────────────────────────────────────────────

const adapterCache = new Map<string, ChainAdapter>();

const EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

const VIEM_CHAINS: Record<string, Record<string, Chain>> = {
  base: { sepolia: baseSepolia, mainnet: base },
  ethereum: { sepolia: sepolia, mainnet: mainnet },
  arbitrum: { sepolia: arbitrumSepolia, mainnet: arbitrum },
};

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

export function _resetAdapterCache(): void {
  adapterCache.clear();
}

export function evictAdapter(cacheKey: string): void {
  adapterCache.delete(cacheKey);
}

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
    const explorerUrl = EVM_EXPLORER_URLS[chain]?.[chainConfig.network] ?? '';
    const aliases = await getEvmAliases(cacheKey);
    const viemChain = VIEM_CHAINS[chain]?.[chainConfig.network];
    if (!viemChain) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED',
        `Unsupported chain/network combination: "${chain}" on "${chainConfig.network}". No viem chain configuration found.`,
        { chain },
      );
    }
    adapter = createEvmAdapter(chain, chainConfig.rpc, explorerUrl, aliases, viemChain);
  } else if (chain === 'solana') {
    const aliases = await getSolanaAliases(cacheKey);
    adapter = createSolanaAdapter(chainConfig.rpc, aliases, network);
  } else {
    throw new MoneyError('CHAIN_NOT_CONFIGURED', `Unknown chain "${chain}".`, { chain });
  }

  adapterCache.set(cacheKey, adapter);
  return adapter;
}

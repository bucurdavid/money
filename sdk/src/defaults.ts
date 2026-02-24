/**
 * defaults.ts — Default chain configurations for money SDK
 *
 * Structured as chain → network → config to support both testnet and mainnet.
 */

import type { ChainConfig, NetworkType } from './types.js';

/** Default chain configs used by money.setup() */
export const DEFAULT_CHAIN_CONFIGS: Record<string, Record<NetworkType, ChainConfig>> = {
  fast: {
    testnet: {
      rpc: 'https://proxy.fastset.xyz',
      keyfile: '~/.money/keys/fast.json',
      network: 'testnet',
      defaultToken: 'SET',
    },
    mainnet: {
      rpc: 'https://proxy.fastset.xyz',
      keyfile: '~/.money/keys/fast-mainnet.json',
      network: 'mainnet',
      defaultToken: 'SET',
    },
  },
  base: {
    testnet: {
      rpc: 'https://sepolia.base.org',
      keyfile: '~/.money/keys/evm.json',
      network: 'sepolia',
      defaultToken: 'ETH',
    },
    mainnet: {
      rpc: 'https://mainnet.base.org',
      keyfile: '~/.money/keys/evm-mainnet.json',
      network: 'mainnet',
      defaultToken: 'ETH',
    },
  },
  ethereum: {
    testnet: {
      rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
      keyfile: '~/.money/keys/evm.json',
      network: 'sepolia',
      defaultToken: 'ETH',
    },
    mainnet: {
      rpc: 'https://eth.llamarpc.com',
      keyfile: '~/.money/keys/evm-mainnet.json',
      network: 'mainnet',
      defaultToken: 'ETH',
    },
  },
  arbitrum: {
    testnet: {
      rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
      keyfile: '~/.money/keys/evm.json',
      network: 'sepolia',
      defaultToken: 'ETH',
    },
    mainnet: {
      rpc: 'https://arb1.arbitrum.io/rpc',
      keyfile: '~/.money/keys/evm-mainnet.json',
      network: 'mainnet',
      defaultToken: 'ETH',
    },
  },
  solana: {
    testnet: {
      rpc: 'https://api.devnet.solana.com',
      keyfile: '~/.money/keys/solana.json',
      network: 'devnet',
      defaultToken: 'SOL',
    },
    mainnet: {
      rpc: 'https://api.mainnet-beta.solana.com',
      keyfile: '~/.money/keys/solana-mainnet.json',
      network: 'mainnet',
      defaultToken: 'SOL',
    },
  },
};

/**
 * Derive the config storage key from chain + network.
 * Testnet uses bare chain name (backward compat), mainnet uses "chain:mainnet".
 */
export function configKey(chain: string, network: NetworkType): string {
  return network === 'mainnet' ? `${chain}:mainnet` : chain;
}

/**
 * Parse a config key back to { chain, network }.
 */
export function parseConfigKey(key: string): { chain: string; network: NetworkType } {
  if (key.endsWith(':mainnet')) {
    return { chain: key.slice(0, -8), network: 'mainnet' };
  }
  return { chain: key, network: 'testnet' };
}

/**
 * Get all supported chain names.
 */
export function supportedChains(): string[] {
  return Object.keys(DEFAULT_CHAIN_CONFIGS);
}

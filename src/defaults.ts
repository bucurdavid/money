/**
 * defaults.ts — Default chain configurations for @fast/money SDK
 *
 * Structured as chain → network → config to support both testnet and mainnet.
 */

import type { ChainConfig, NetworkType, ChainName, TokenConfig } from './types.js';

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
      defaultToken: 'USDC',
    },
    mainnet: {
      rpc: 'https://mainnet.base.org',
      keyfile: '~/.money/keys/evm-mainnet.json',
      network: 'mainnet',
      defaultToken: 'USDC',
    },
  },
  ethereum: {
    testnet: {
      rpc: 'https://rpc.sepolia.org',
      keyfile: '~/.money/keys/evm.json',
      network: 'sepolia',
      defaultToken: 'USDC',
    },
    mainnet: {
      rpc: 'https://eth.llamarpc.com',
      keyfile: '~/.money/keys/evm-mainnet.json',
      network: 'mainnet',
      defaultToken: 'USDC',
    },
  },
  arbitrum: {
    testnet: {
      rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
      keyfile: '~/.money/keys/evm.json',
      network: 'sepolia',
      defaultToken: 'USDC',
    },
    mainnet: {
      rpc: 'https://arb1.arbitrum.io/rpc',
      keyfile: '~/.money/keys/evm-mainnet.json',
      network: 'mainnet',
      defaultToken: 'USDC',
    },
  },
  solana: {
    testnet: {
      rpc: 'https://api.devnet.solana.com',
      keyfile: '~/.money/keys/solana.json',
      network: 'devnet',
      defaultToken: 'USDC',
    },
    mainnet: {
      rpc: 'https://api.mainnet-beta.solana.com',
      keyfile: '~/.money/keys/solana-mainnet.json',
      network: 'mainnet',
      defaultToken: 'USDC',
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

/** Default USDC aliases seeded on first setup() per chain+network */
export const DEFAULT_ALIASES: Partial<Record<ChainName, Partial<Record<NetworkType, Record<string, TokenConfig>>>>> = {
  base: {
    testnet: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
    },
    mainnet: {
      USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    },
  },
  ethereum: {
    testnet: {
      USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
    },
    mainnet: {
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },
  arbitrum: {
    testnet: {
      USDC: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 },
    },
    mainnet: {
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    },
  },
  solana: {
    testnet: {
      USDC: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 },
    },
    mainnet: {
      USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    },
  },
};

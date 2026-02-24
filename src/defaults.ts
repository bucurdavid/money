/**
 * defaults.ts — Default chain configurations for @fast/money SDK
 */

import type { ChainConfig } from './types.js';

/** Default chain configs used by money.setup() */
export const DEFAULT_CHAIN_CONFIGS: Record<string, ChainConfig> = {
  fast: {
    rpc: 'https://proxy.fastset.xyz',
    keyfile: '~/.money/keys/fast.json',
    network: 'testnet',
    defaultToken: 'SET',
  },
  base: {
    rpc: 'https://sepolia.base.org',
    keyfile: '~/.money/keys/evm.json',
    network: 'sepolia',
    defaultToken: 'USDC',
    tokens: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
    },
  },
  ethereum: {
    rpc: 'https://rpc.sepolia.org',
    keyfile: '~/.money/keys/evm.json',
    network: 'sepolia',
    defaultToken: 'USDC',
    tokens: {
      USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
    },
  },
  arbitrum: {
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    keyfile: '~/.money/keys/evm.json',
    network: 'sepolia',
    defaultToken: 'USDC',
    tokens: {
      USDC: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
    },
  },
  solana: {
    rpc: 'https://api.devnet.solana.com',
    keyfile: '~/.money/keys/solana.json',
    network: 'devnet',
    defaultToken: 'USDC',
    tokens: {
      USDC: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' },
    },
  },
};

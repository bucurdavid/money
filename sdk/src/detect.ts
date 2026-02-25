/**
 * detect.ts — Protocol-based address detection
 *
 * Three protocols: 'evm', 'solana', 'fast'.
 * Built-in chains have hardcoded protocol mappings.
 * Custom chains are looked up from config.customChains.
 */

import { loadConfig } from './config.js';

// ─── Patterns ─────────────────────────────────────────────────────────────────

const PATTERNS: Record<string, RegExp> = {
  fast:   /^set1[a-z0-9]{38,}$/,           // bech32m
  evm:    /^0x[0-9a-fA-F]{40}$/,           // hex, 20 bytes
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, // base58
};

// ─── Built-in protocol mapping ────────────────────────────────────────────────

const BUILT_IN_PROTOCOLS: Record<string, string> = {
  base: 'evm',
  ethereum: 'evm',
  arbitrum: 'evm',
  fast: 'fast',
  solana: 'solana',
};

const BUILT_IN_EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

// ─── Protocol resolution ──────────────────────────────────────────────────────

/**
 * Resolve a chain name to its protocol type ('evm', 'solana', 'fast').
 * Checks built-in mapping first, then customChains in config.
 */
async function getChainProtocol(chain: string): Promise<string | null> {
  const bare = chain.includes(':') ? chain.split(':')[0]! : chain;
  const builtIn = BUILT_IN_PROTOCOLS[bare];
  if (builtIn) return builtIn;

  // Check persisted custom chains
  const config = await loadConfig();
  const customDef = config.customChains?.[bare];
  return customDef?.type ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Identify which chain(s) an address could belong to based on format.
 * Returns all possible chains — built-ins plus any custom chains from config.
 */
export async function identifyChains(address: string): Promise<string[]> {
  if (PATTERNS.fast.test(address)) {
    return ['fast'];
  }
  if (PATTERNS.evm.test(address)) {
    // Built-in EVM chains + all custom EVM chains from config
    const config = await loadConfig();
    const customEvmChains = Object.entries(config.customChains ?? {})
      .filter(([, def]) => def.type === 'evm')
      .map(([name]) => name);
    return [...BUILT_IN_EVM_CHAINS, ...customEvmChains];
  }
  if (PATTERNS.solana.test(address)) {
    return ['solana'];
  }
  return [];
}

/**
 * Check if an address matches the expected pattern for the given chain.
 * Looks up protocol from built-in mapping or config.
 */
export async function isValidAddress(address: string, chain: string): Promise<boolean> {
  const pattern = await getAddressPattern(chain);
  if (pattern === null) return false;
  return pattern.test(address);
}

/**
 * Get the regex pattern for a chain name.
 * Resolves protocol from built-in mapping or config.customChains.
 */
export async function getAddressPattern(chain: string): Promise<RegExp | null> {
  const protocol = await getChainProtocol(chain);
  if (!protocol) return null;
  return PATTERNS[protocol] ?? null;
}

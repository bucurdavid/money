// Patterns
const PATTERNS: Record<string, RegExp> = {
  fast:   /^set1[a-z0-9]{38,}$/,           // bech32m
  evm:    /^0x[0-9a-fA-F]{40}$/,           // hex, 20 bytes
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, // base58
};

// EVM chains that share the same address format
const EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

/**
 * Identify which chain(s) an address could belong to based on format.
 * Returns all possible chains — caller decides how to narrow.
 * EVM addresses return all 3 EVM chains since they share the same format.
 */
export function identifyChains(address: string): string[] {
  if (PATTERNS.fast.test(address)) {
    return ['fast'];
  }
  if (PATTERNS.evm.test(address)) {
    return [...EVM_CHAINS];
  }
  if (PATTERNS.solana.test(address)) {
    return ['solana'];
  }
  return [];
}

/**
 * Check if an address matches the expected pattern for the given chain.
 * EVM chains (base, ethereum, arbitrum) all use the evm pattern.
 */
export function isValidAddress(address: string, chain: string): boolean {
  const pattern = getAddressPattern(chain);
  if (pattern === null) return false;
  return pattern.test(address);
}

/**
 * Get the regex pattern for a chain name.
 * EVM chain names are mapped to the evm pattern.
 */
export function getAddressPattern(chain: string): RegExp | null {
  const bare = chain.includes(':') ? chain.split(':')[0] : chain;
  if (EVM_CHAINS.includes(bare)) {
    return PATTERNS.evm;
  }
  return PATTERNS[bare] ?? null;
}

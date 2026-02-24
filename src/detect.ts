// Patterns
const PATTERNS: Record<string, RegExp> = {
  fast:   /^set1[a-z0-9]{38,}$/,           // bech32m
  evm:    /^0x[0-9a-fA-F]{40}$/,           // hex, 20 bytes
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, // base58
};

// EVM chains that share the same address format
const EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

/**
 * Detect chain from address format.
 * For EVM addresses, returns the first EVM chain found in configuredChains,
 * defaulting to 'base' if none are configured.
 */
export function detectChain(address: string, configuredChains: string[]): string | null {
  if (PATTERNS.fast.test(address)) {
    return 'fast';
  }
  if (PATTERNS.evm.test(address)) {
    const match = EVM_CHAINS.find(c => configuredChains.includes(c));
    return match ?? 'base';
  }
  if (PATTERNS.solana.test(address)) {
    return 'solana';
  }
  return null;
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

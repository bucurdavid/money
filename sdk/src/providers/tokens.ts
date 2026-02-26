/**
 * providers/tokens.ts — Well-known token addresses per chain
 *
 * Used by swap/bridge/price to resolve token symbols to addresses.
 * Only includes the most commonly needed tokens.
 */

export interface WellKnownToken {
  symbol: string;
  decimals: number;
  addresses: Record<string, string>;  // chain name → contract address / mint
}

/**
 * Well-known tokens with addresses on each chain.
 * Keys are uppercase symbols. Addresses are per-chain.
 *
 * Native tokens (ETH, SOL, etc.) use special sentinel addresses:
 * - EVM native: "0x0000000000000000000000000000000000000000" (zero address — the universal standard)
 * - Solana native: "So11111111111111111111111111111111111111112" (wrapped SOL mint)
 */
const EVM_NATIVE = '0x0000000000000000000000000000000000000000';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const WELL_KNOWN_TOKENS: WellKnownToken[] = [
  {
    symbol: 'USDC',
    decimals: 6,
    addresses: {
      ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      bsc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
  },
  {
    symbol: 'USDT',
    decimals: 6,
    addresses: {
      ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      base: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      optimism: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      bsc: '0x55d398326f99059fF775485246999027B3197955',
      avalanche: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
      solana: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    },
  },
  {
    symbol: 'WETH',
    decimals: 18,
    addresses: {
      ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      base: '0x4200000000000000000000000000000000000006',
      arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      polygon: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      optimism: '0x4200000000000000000000000000000000000006',
      avalanche: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
    },
  },
  {
    symbol: 'WBTC',
    decimals: 8,
    addresses: {
      ethereum: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      base: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b',
      arbitrum: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      polygon: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
      optimism: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
    },
  },
  {
    symbol: 'DAI',
    decimals: 18,
    addresses: {
      ethereum: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      base: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      arbitrum: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      polygon: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      optimism: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
  },
  {
    symbol: 'WSET',
    decimals: 18,
    addresses: {
      ethereum: '0x485DdBAa2D62ee70D03B4789912948f3aF7E35B8',
      arbitrum: '0xA0431d49B71c6f07603272C6C580560AfF41598E',
    },
  },
];

/**
 * Native token sentinel addresses per chain.
 * Used by swap APIs that need an address for native tokens.
 */
export const NATIVE_TOKEN_ADDRESS: Record<string, string> = {
  ethereum: EVM_NATIVE,
  base: EVM_NATIVE,
  arbitrum: EVM_NATIVE,
  polygon: EVM_NATIVE,
  optimism: EVM_NATIVE,
  bsc: EVM_NATIVE,
  avalanche: EVM_NATIVE,
  fantom: EVM_NATIVE,
  zksync: EVM_NATIVE,
  linea: EVM_NATIVE,
  scroll: EVM_NATIVE,
  solana: WSOL_MINT,
  fast: 'fa575e7000000000000000000000000000000000000000000000000000000000',
};

/**
 * Native token symbols per chain.
 */
export const NATIVE_TOKEN_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  base: 'ETH',
  arbitrum: 'ETH',
  polygon: 'POL',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
  fantom: 'FTM',
  zksync: 'ETH',
  linea: 'ETH',
  scroll: 'ETH',
  solana: 'SOL',
  fast: 'SET',
};

/**
 * Native token decimals per chain.
 */
export const NATIVE_TOKEN_DECIMALS: Record<string, number> = {
  ethereum: 18,
  base: 18,
  arbitrum: 18,
  polygon: 18,
  optimism: 18,
  bsc: 18,
  avalanche: 18,
  fantom: 18,
  zksync: 18,
  linea: 18,
  scroll: 18,
  solana: 9,
  fast: 18,
};

/**
 * Resolve a token symbol or address to a contract address for a given chain.
 *
 * Resolution order:
 * 1. If it looks like an address (0x... or base58), return it directly
 * 2. Check if it matches a native token symbol for the chain → return native sentinel
 * 3. Check well-known tokens map
 * 4. Return null if not found
 */
export function resolveTokenAddress(token: string, chain: string): { address: string; decimals: number } | null {
  // Raw address — return directly (decimals unknown, caller must handle)
  if (token.startsWith('0x') || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token)) {
    return null;  // caller should use token directly as address, look up decimals separately
  }

  const upper = token.toUpperCase();

  // Native token for this chain
  const nativeSymbol = NATIVE_TOKEN_SYMBOL[chain];
  if (nativeSymbol && upper === nativeSymbol) {
    const addr = NATIVE_TOKEN_ADDRESS[chain];
    const dec = NATIVE_TOKEN_DECIMALS[chain];
    if (addr && dec !== undefined) {
      return { address: addr, decimals: dec };
    }
  }

  // ETH / SOL as aliases even on chains where native is different (e.g. WETH on Polygon)
  // Skip — only match native symbols exactly

  // Well-known tokens
  const wkt = WELL_KNOWN_TOKENS.find((t) => t.symbol === upper);
  if (wkt) {
    const addr = wkt.addresses[chain];
    if (addr) {
      return { address: addr, decimals: wkt.decimals };
    }
  }

  return null;
}

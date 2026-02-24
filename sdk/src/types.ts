// Chain names
export type ChainName = 'fast' | 'base' | 'ethereum' | 'arbitrum' | 'solana';

// Network types
export type NetworkType = 'testnet' | 'mainnet';

// Config file structure (~/.money/config.json)
export interface TokenConfig {
  address?: string;  // EVM contract address
  mint?: string;     // Solana mint address
  decimals?: number; // Override default decimals
}

export interface ChainConfig {
  rpc: string;
  keyfile: string;
  network: string;
  defaultToken: string;
}

export interface MoneyConfig {
  chains: Record<string, ChainConfig>;
}

// ─── Param types (JSON-only method signatures) ───────────────────────────────

/** Params for money.setup() */
export interface SetupParams {
  chain: string;
  network?: NetworkType;
  rpc?: string;
}

/** Params for money.balance() */
export interface BalanceParams {
  chain: string;
  token?: string; // defaults to "native" → resolved to chain's native token
}

/** Params for money.send() */
export interface SendParams {
  to: string;
  amount: number | string;
  chain: string;
  token?: string; // defaults to "native"
}

/** Params for money.faucet() */
export interface FaucetParams {
  chain: string;
}

/** Params for money.identifyChains() */
export interface IdentifyChainsParams {
  address: string;
}

/** Params for money.getToken() */
export interface GetTokenParams {
  chain: string;
  name: string;
}

/** Params for money.registerToken() */
export interface RegisterTokenParams {
  chain: string;
  name: string;
  address?: string;  // EVM contract address
  mint?: string;     // Solana mint address
  decimals?: number;
}

/** Params for money.tokens() */
export interface TokensParams {
  chain: string;
}

/** Params for money.history() */
export interface HistoryParams {
  chain?: string;
  limit?: number;
}

// ─── Return types for SDK methods ────────────────────────────────────────────

export interface SetupResult {
  chain: string;
  address: string;
  network: string;
  note: string;
}

export interface ChainStatus {
  chain: string;
  address: string;
  network: string;
  defaultToken: string;
  status: 'ready' | 'no-key' | 'no-rpc' | 'error';
  balance?: string;   // best-effort native token balance
}

// StatusResult wraps the array
export interface StatusResult {
  entries: ChainStatus[];
  note: string;
}

export interface BalanceResult {
  chain: string;
  network: NetworkType;
  address: string;
  amount: string;
  token: string;
  note: string;
}

export interface SendResult {
  txHash: string;
  explorerUrl: string;
  fee: string;
  chain: string;
  network: NetworkType;
  note: string;
}

export interface FaucetResult {
  chain: string;
  network: NetworkType;
  amount: string;
  token: string;
  txHash: string;
  note: string;
}

export interface IdentifyChainsResult {
  chains: string[];
  note: string;
}

export interface TokensResult {
  tokens: TokenInfo[];
  note: string;
}

export interface HistoryResult {
  entries: HistoryEntry[];
  note: string;
}

export interface HistoryEntry {
  ts: string;          // ISO timestamp
  chain: string;       // Bare chain name (e.g. "fast", "base")
  network: NetworkType; // "testnet" | "mainnet"
  to: string;          // recipient address
  amount: string;
  token: string;
  txHash: string;
}

export interface TokenInfo {
  chain: string;       // Bare chain name (e.g. "fast", "base", "solana")
  network: NetworkType; // "testnet" | "mainnet"
  name: string;        // Token symbol (e.g. "USDC", "WETH")
  address?: string;    // EVM ERC-20 contract address
  mint?: string;       // Solana SPL mint address
  decimals: number;
}

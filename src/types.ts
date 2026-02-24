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

// Return types for SDK methods
export interface SetupResult {
  chain: string;
  address: string;
  network: string;
}

export interface ChainInfo {
  chain: string;       // Bare chain name
  address: string;
  network: string;     // RPC-level network (e.g. "sepolia", "devnet", "mainnet")
  defaultToken: string;
  status: 'ready' | 'no-key' | 'no-rpc' | 'error';
}

export interface WalletInfo {
  chain: string;       // Bare chain name
  network: NetworkType; // "testnet" | "mainnet"
  address: string;
  balances: Record<string, string>;
}

export interface BalanceResult {
  chain: string;       // Bare chain name
  network: NetworkType; // "testnet" | "mainnet"
  address: string;
  amount: string;
  token: string;
}

export interface SendOptions {
  chain?: string;
  token?: string;
  memo?: string;
}

export interface SendResult {
  txHash: string;
  explorerUrl: string;
  fee: string;
  chain: string;       // Bare chain name
  network: NetworkType; // "testnet" | "mainnet"
}

export interface FaucetResult {
  chain: string;       // Bare chain name
  network: NetworkType; // "testnet" | "mainnet"
  amount: string;
  token: string;
  txHash: string;
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

export interface SetupOptions {
  network?: NetworkType;
  rpc?: string;  // Override default RPC endpoint. Stored in config and persists across sessions.
}

export interface TokenInfo {
  chain: string;       // Bare chain name (e.g. "fast", "base", "solana")
  network: NetworkType; // "testnet" | "mainnet"
  name: string;        // Token symbol (e.g. "USDC", "WETH")
  address?: string;    // EVM ERC-20 contract address
  mint?: string;       // Solana SPL mint address
  decimals: number;
}

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
  tokens?: Record<string, TokenConfig>;
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
  chain: string;
  address: string;
  network: string;
  defaultToken: string;
  status: 'ready' | 'no-key' | 'no-rpc' | 'error';
}

export interface WalletInfo {
  chain: string;
  address: string;
  balances: Record<string, string>;
}

export interface BalanceResult {
  chain: string;
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
  chain: string;
}

export interface FaucetResult {
  chain: string;
  amount: string;
  token: string;
  txHash: string;
}

export interface HistoryEntry {
  txHash: string;
  direction: 'sent' | 'received';
  amount: string;
  token: string;
  counterparty: string;
  timestamp: string;
}

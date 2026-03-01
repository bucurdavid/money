import type { z } from 'zod';
import type * as S from './schemas.js';

// Chain names
export type ChainName = 'fast' | 'base' | 'ethereum' | 'arbitrum' | 'polygon' | 'optimism' | 'bsc' | 'avalanche' | 'fantom' | 'zksync' | 'linea' | 'scroll' | 'solana';

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

/** Persisted metadata for a custom EVM chain */
export interface CustomChainDef {
  type: 'evm';
  chainId: number;
  explorer?: string;
}

export interface MoneyConfig {
  chains: Record<string, ChainConfig>;
  customChains?: Record<string, CustomChainDef>;
  apiKeys?: Record<string, string>;
}

// ─── Param types (JSON-only method signatures) ───────────────────────────────

/** Params for money.setApiKey() */
export type SetApiKeyParams = z.infer<typeof S.SetApiKeyParams>;

/** Params for money.setup() */
export type SetupParams = z.infer<typeof S.SetupParams>;

/** Params for money.balance() */
export type BalanceParams = z.infer<typeof S.BalanceParams>;

/** Params for money.send() */
export type SendParams = z.infer<typeof S.SendParams>;

/** Params for money.faucet() */
export type FaucetParams = z.infer<typeof S.FaucetParams>;

/** Params for money.identifyChains() */
export type IdentifyChainsParams = z.infer<typeof S.IdentifyChainsParams>;

/** Params for money.getToken() */
export type GetTokenParams = z.infer<typeof S.GetTokenParams>;

/** Params for money.registerToken() */
export type RegisterTokenParams = z.infer<typeof S.RegisterTokenParams>;

/** Params for money.tokens() */
export type TokensParams = z.infer<typeof S.TokensParams>;

/** Params for money.history() */
export type HistoryParams = z.infer<typeof S.HistoryParams>;

/** Params for money.createPaymentLink() */
export type PaymentLinkParams = z.infer<typeof S.PaymentLinkParams>;

/** Result of money.createPaymentLink() */
export type PaymentLinkResult = z.infer<typeof S.PaymentLinkResult>;

/** Params for money.listPaymentLinks() */
export type PaymentLinksParams = z.infer<typeof S.PaymentLinksParams>;

/** Result of money.listPaymentLinks() */
export type PaymentLinksResult = z.infer<typeof S.PaymentLinksResult>;

/** Params for money.registerEvmChain() */
export type RegisterEvmChainParams = z.infer<typeof S.RegisterEvmChainParams>;

// ─── Return types for SDK methods ────────────────────────────────────────────

export type SetupResult = z.infer<typeof S.SetupResult>;

export interface ChainStatus {
  chain: string;
  address: string;
  network: string;
  defaultToken: string;
  status: 'ready' | 'no-key' | 'no-rpc' | 'error';
  balance?: string;   // best-effort native token balance
}

// StatusResult wraps the array
export type StatusResult = z.infer<typeof S.StatusResult>;

export type BalanceResult = z.infer<typeof S.BalanceResult>;

export type SendResult = z.infer<typeof S.SendResult>;

export type FaucetResult = z.infer<typeof S.FaucetResult>;

export type IdentifyChainsResult = z.infer<typeof S.IdentifyChainsResult>;

/** A token discovered on-chain (via RPC, not user-registered) */
export interface OwnedToken {
  symbol: string;       // token name from on-chain metadata, or address if unknown
  address: string;      // token ID (hex) or mint address
  balance: string;      // human-readable amount (already decimal-adjusted)
  rawBalance: string;   // raw units as decimal string (before decimal adjustment)
  decimals: number;
}

export type TokensResult = z.infer<typeof S.TokensResult>;

export type HistoryResult = z.infer<typeof S.HistoryResult>;

export interface HistoryEntry {
  ts: string;          // ISO timestamp
  chain: string;       // Bare chain name (e.g. "fast", "base")
  network: NetworkType; // "testnet" | "mainnet"
  to: string;          // recipient address
  amount: string;
  token: string;
  txHash: string;
}

// ─── Payment link types ─────────────────────────────────────────────────────

export interface PaymentLinkEntry {
  ts: string;
  payment_id: string;
  direction: 'created' | 'paid';
  chain: string;
  network: string;
  receiver: string;
  amount: string;
  token: string;
  memo: string;
  url: string;
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

// ─── Export keys types ──────────────────────────────────────────────────────

/** Params for money.exportKeys() */
export type ExportKeysParams = z.infer<typeof S.ExportKeysParams>;

/** Result of money.exportKeys() */
export type ExportKeysResult = z.infer<typeof S.ExportKeysResult>;

// ─── Sign types ─────────────────────────────────────────────────────────────

/** Params for money.sign() */
export type SignParams = z.infer<typeof S.SignParams>;

/** Result of money.sign() */
export type SignResult = z.infer<typeof S.SignResult>;

/** Params for money.verifySign() */
export type VerifySignParams = z.infer<typeof S.VerifySignParams>;

/** Result of money.verifySign() */
export type VerifySignResult = z.infer<typeof S.VerifySignResult>;

// ─── Swap / Quote types ─────────────────────────────────────────────────────

/** Params for money.quote() and money.swap() */
export type SwapParams = z.infer<typeof S.SwapParams>;

/** Result of money.quote() */
export type QuoteResult = z.infer<typeof S.QuoteResult>;

/** Result of money.swap() */
export type SwapResult = z.infer<typeof S.SwapResult>;

// ─── Price / Token info types ───────────────────────────────────────────────

/** Params for money.price() */
export type PriceParams = z.infer<typeof S.PriceParams>;

/** Result of money.price() */
export type PriceResult = z.infer<typeof S.PriceResult>;

/** Params for money.tokenInfo() */
export type TokenInfoParams = z.infer<typeof S.TokenInfoParams>;

/** Result of money.tokenInfo() */
export type TokenInfoResult = z.infer<typeof S.TokenInfoResult>;

// ─── Bridge types ───────────────────────────────────────────────────────────

/** Params for money.bridge() */
export type BridgeParams = z.infer<typeof S.BridgeParams>;

/** Result of money.bridge() */
export type BridgeResult = z.infer<typeof S.BridgeResult>;

// ─── Providers type ─────────────────────────────────────────────────────────

/** Result of money.providers() */
export type ProvidersResult = z.infer<typeof S.ProvidersResult>;

// ─── Help / Describe types ──────────────────────────────────────────────────

/** A brief entry returned by money.help() */
export interface HelpEntry {
  name: string;
  params: string;
  description: string;
}

/** Full method documentation returned by money.describe() */
export interface DescribeResult {
  name: string;
  params: string;
  description: string;
  paramDetails: Record<string, string>;
  result: string;
  examples: string[];
  notes: string;
}

// ─── Unit conversion types ──────────────────────────────────────────────────

/** Params for money.parseUnits() — convert human amount to raw bigint */
export type ParseUnitsParams = z.infer<typeof S.ParseUnitsParams>;

/** Params for money.formatUnits() — convert raw bigint to human string */
export type FormatUnitsParams = z.infer<typeof S.FormatUnitsParams>;

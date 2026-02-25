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

/** Params for money.setApiKey() */
export interface SetApiKeyParams {
  provider: string;    // provider name (e.g. "jupiter", "my-dex")
  apiKey: string;
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
  network?: NetworkType;
  token?: string; // defaults to "native" → resolved to chain's native token
}

/** Params for money.send() */
export interface SendParams {
  to: string;
  amount: number | string;
  chain: string;
  network?: NetworkType;
  token?: string; // defaults to "native"
}

/** Params for money.faucet() */
export interface FaucetParams {
  chain: string;
  network?: NetworkType;
}

/** Params for money.identifyChains() */
export interface IdentifyChainsParams {
  address: string;
}

/** Params for money.getToken() */
export interface GetTokenParams {
  chain: string;
  network?: NetworkType;
  name: string;
}

/** Params for money.registerToken() */
export interface RegisterTokenParams {
  chain: string;
  network?: NetworkType;
  name: string;
  address?: string;  // EVM contract address
  mint?: string;     // Solana mint address
  decimals?: number;
}

/** Params for money.tokens() */
export interface TokensParams {
  chain: string;
  network?: NetworkType;
}

/** Params for money.history() */
export interface HistoryParams {
  chain?: string;
  network?: NetworkType;
  limit?: number;
}

/** Params for money.registerEvmChain() */
export interface RegisterEvmChainParams {
  chain: string;
  chainId: number;
  rpc: string;
  explorer?: string;   // e.g. "https://polygonscan.com/tx/"
  defaultToken?: string; // defaults to "ETH"
  network?: NetworkType; // defaults to "testnet"
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

/** A token discovered on-chain (via RPC, not user-registered) */
export interface OwnedToken {
  symbol: string;       // token name from on-chain metadata, or address if unknown
  address: string;      // token ID (hex) or mint address
  balance: string;      // human-readable amount
  decimals: number;
}

export interface TokensResult {
  chain: string;
  network: NetworkType;
  owned: OwnedToken[];
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

// ─── Export keys types ──────────────────────────────────────────────────────

/** Params for money.exportKeys() */
export interface ExportKeysParams {
  chain: string;
  network?: NetworkType;
}

/** Result of money.exportKeys() */
export interface ExportKeysResult {
  address: string;
  privateKey: string;
  keyfile: string;       // absolute path to the keyfile on disk
  chain: string;
  chainType: 'evm' | 'solana' | 'fast';
  note: string;
}

// ─── Sign types ─────────────────────────────────────────────────────────────

/** Params for money.sign() */
export interface SignParams {
  chain: string;
  message: string | Uint8Array;
  network?: NetworkType;
}

/** Result of money.sign() */
export interface SignResult {
  signature: string;     // EVM: 0x hex, Solana: base58, Fast: hex
  address: string;
  chain: string;
  network: NetworkType;
  note: string;
}

// ─── Swap / Quote types ─────────────────────────────────────────────────────

/** Params for money.quote() and money.swap() */
export interface SwapParams {
  chain: string;
  from: string;              // token symbol ("SOL") or contract address
  to: string;                // token symbol ("USDC") or contract address
  amount: number | string;   // human units
  network?: NetworkType;
  slippageBps?: number;      // default 50 (0.5%)
  provider?: string;         // optional: force a specific provider
}

/** Result of money.quote() */
export interface QuoteResult {
  fromToken: string;
  toToken: string;
  fromAmount: string;        // human units
  toAmount: string;          // human units
  rate: string;              // e.g. "1 SOL = 145.23 USDC"
  priceImpact: string;       // percentage
  provider: string;
  chain: string;
  network: NetworkType;
  note: string;
}

/** Result of money.swap() */
export interface SwapResult {
  txHash: string;
  explorerUrl: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  provider: string;
  chain: string;
  network: NetworkType;
  note: string;
}

// ─── Price / Token info types ───────────────────────────────────────────────

/** Params for money.price() */
export interface PriceParams {
  token: string;             // symbol or address
  chain?: string;            // optional, narrows search
  provider?: string;         // provider name (e.g. "dexscreener"); default: first registered
}

/** Result of money.price() */
export interface PriceResult {
  price: string;             // USD price
  symbol: string;
  name: string;
  priceChange24h?: string;
  volume24h?: string;
  liquidity?: string;
  marketCap?: string;
  chain?: string;
  note: string;
}

/** Params for money.tokenInfo() */
export interface TokenInfoParams {
  token: string;
  chain?: string;
  provider?: string;         // provider name; default: first registered
}

/** Result of money.tokenInfo() */
export interface TokenInfoResult {
  name: string;
  symbol: string;
  address: string;
  decimals?: number;
  price: string;
  priceChange24h?: string;
  volume24h?: string;
  liquidity?: string;
  marketCap?: string;
  pairs: Array<{ dex: string; pairAddress: string; quoteToken: string; price: string }>;
  // Fast chain on-chain metadata (only populated for Fast tokens)
  admin?: string;
  minters?: string[];
  totalSupply?: string;
  chain?: string;
  note: string;
}

// ─── Bridge types ───────────────────────────────────────────────────────────

/** Params for money.bridge() */
export interface BridgeParams {
  from: { chain: string; token: string };
  to: { chain: string; token?: string };
  amount: number | string;   // human units
  network?: NetworkType;
  receiver?: string;         // defaults to own address on dest chain
  provider?: string;
}

/** Result of money.bridge() */
export interface BridgeResult {
  txHash: string;
  explorerUrl: string;
  fromChain: string;
  toChain: string;
  fromAmount: string;
  toAmount: string;
  orderId: string;
  estimatedTime?: string;
  note: string;
}

// ─── Unit conversion types ──────────────────────────────────────────────────

/** Params for money.parseUnits() — convert human amount to raw bigint */
export interface ParseUnitsParams {
  amount: number | string;
  chain?: string;          // Look up decimals from token alias
  network?: NetworkType;
  token?: string;          // Token name to look up decimals (defaults to chain's native token)
  decimals?: number;       // Explicit decimals — skip token lookup
}

/** Params for money.formatUnits() — convert raw bigint to human string */
export interface FormatUnitsParams {
  amount: bigint | number | string;
  chain?: string;
  network?: NetworkType;
  token?: string;
  decimals?: number;
}


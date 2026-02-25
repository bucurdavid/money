/**
 * schemas.ts — Zod schemas for all SDK method params and results.
 *
 * Single source of truth for:
 *   1. Runtime input validation (.parse())
 *   2. TypeScript types (z.infer<>)
 *   3. Auto-generated help() / describe() documentation
 *
 * Each method has a params schema, result schema, and metadata
 * (description, examples, notes). The METHOD_SCHEMAS registry
 * drives help() and describe() via introspection helpers.
 */

import { z } from 'zod';

// ─── Shared enums ────────────────────────────────────────────────────────────

const NetworkType = z.enum(['testnet', 'mainnet']);

// ─── setup ───────────────────────────────────────────────────────────────────

export const SetupParams = z.object({
  chain: z.string().describe('Chain name (e.g. "fast", "ethereum", "base", "solana")'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
  rpc: z.string().optional().describe('Custom RPC URL override'),
});

export const SetupResult = z.object({
  chain: z.string(),
  address: z.string(),
  network: z.string(),
  note: z.string(),
});

const setupMeta = {
  description: 'Set up a wallet on a chain. Creates a keyfile if none exists.',
  examples: [
    'await money.setup({ chain: "fast" })',
    'await money.setup({ chain: "ethereum", network: "mainnet" })',
    'await money.setup({ chain: "base", rpc: "https://my-rpc.io" })',
  ],
  notes: 'Idempotent — safe to call multiple times. Same key = same address across networks.',
} as const;

// ─── status ──────────────────────────────────────────────────────────────────

export const StatusResult = z.object({
  entries: z.array(z.object({
    chain: z.string(),
    address: z.string(),
    network: z.string(),
    defaultToken: z.string(),
    status: z.enum(['ready', 'no-key', 'no-rpc', 'error']),
    balance: z.string().optional(),
  })),
  note: z.string(),
});

const statusMeta = {
  description: 'Show all configured chains, addresses, and balances.',
  examples: [
    'await money.status()',
  ],
  notes: 'Read-only. No setup required. Returns every chain you have configured.',
} as const;

// ─── balance ─────────────────────────────────────────────────────────────────

export const BalanceParams = z.object({
  chain: z.string().describe('Chain name'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
  token: z.string().optional().describe('Token symbol or address (defaults to native token)'),
});

export const BalanceResult = z.object({
  chain: z.string(),
  network: NetworkType,
  address: z.string(),
  amount: z.string(),
  token: z.string(),
  note: z.string(),
});

const balanceMeta = {
  description: 'Check token balance on a chain.',
  examples: [
    'await money.balance({ chain: "fast" })',
    'await money.balance({ chain: "ethereum", token: "USDC", network: "mainnet" })',
  ],
  notes: 'Chain must be set up first via money.setup().',
} as const;

// ─── send ────────────────────────────────────────────────────────────────────

export const SendParams = z.object({
  chain: z.string().describe('Chain name'),
  to: z.string().describe('Recipient address'),
  amount: z.union([z.number(), z.string()]).describe('Amount in human-readable units (e.g. 10, "0.5")'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
  token: z.string().optional().describe('Token symbol or address (defaults to native token)'),
});

export const SendResult = z.object({
  txHash: z.string(),
  explorerUrl: z.string(),
  fee: z.string(),
  chain: z.string(),
  network: NetworkType,
  note: z.string(),
});

const sendMeta = {
  description: 'Send tokens to an address.',
  examples: [
    'await money.send({ chain: "fast", to: "set1abc...", amount: 10 })',
    'await money.send({ chain: "ethereum", to: "0xabc...", amount: 0.5, token: "USDC", network: "mainnet" })',
  ],
  notes: 'Chain must be set up first. Address is validated before sending.',
} as const;

// ─── faucet ──────────────────────────────────────────────────────────────────

export const FaucetParams = z.object({
  chain: z.string().describe('Chain name'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

export const FaucetResult = z.object({
  chain: z.string(),
  network: NetworkType,
  amount: z.string(),
  token: z.string(),
  txHash: z.string(),
  note: z.string(),
});

const faucetMeta = {
  description: 'Get free testnet tokens.',
  examples: [
    'await money.faucet({ chain: "fast" })',
    'await money.faucet({ chain: "ethereum" })',
  ],
  notes: 'Testnet only. May be throttled — wait and retry if you get FAUCET_THROTTLED.',
} as const;

// ─── tokens ──────────────────────────────────────────────────────────────────

export const TokensParams = z.object({
  chain: z.string().describe('Chain name'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

export const TokensResult = z.object({
  chain: z.string(),
  network: NetworkType,
  owned: z.array(z.object({
    symbol: z.string(),
    address: z.string(),
    balance: z.string(),
    rawBalance: z.string(),
    decimals: z.number(),
  })),
  note: z.string(),
});

const tokensMeta = {
  description: 'Discover all tokens owned by your wallet on a chain.',
  examples: [
    'await money.tokens({ chain: "fast" })',
    'await money.tokens({ chain: "ethereum", network: "mainnet" })',
  ],
  notes: 'Discovered tokens are cached so you can use their symbol in balance/send.',
} as const;

// ─── swap ────────────────────────────────────────────────────────────────────

export const SwapParams = z.object({
  chain: z.string().describe('Chain name'),
  from: z.string().describe('Source token symbol or address'),
  to: z.string().describe('Destination token symbol or address'),
  amount: z.union([z.number(), z.string()]).describe('Amount to swap in human units'),
  network: NetworkType.optional().describe('Must be "mainnet" — swaps require mainnet liquidity'),
  slippageBps: z.number().optional().describe('Slippage tolerance in basis points (default 50 = 0.5%)'),
  provider: z.string().optional().describe('"jupiter" (Solana) or "paraswap" (EVM) — auto-selected by chain'),
});

export const SwapResult = z.object({
  txHash: z.string(),
  explorerUrl: z.string(),
  fromToken: z.string(),
  toToken: z.string(),
  fromAmount: z.string(),
  toAmount: z.string(),
  provider: z.string(),
  chain: z.string(),
  network: NetworkType,
  note: z.string(),
});

const swapMeta = {
  description: 'Swap one token for another on the same chain.',
  examples: [
    'await money.swap({ chain: "solana", from: "SOL", to: "USDC", amount: 1, network: "mainnet" })',
    'await money.swap({ chain: "ethereum", from: "ETH", to: "USDC", amount: 0.5, network: "mainnet" })',
  ],
  notes: 'Requires network: "mainnet". Jupiter for Solana (needs API key via setApiKey), Paraswap for EVM.',
} as const;

// ─── quote ───────────────────────────────────────────────────────────────────

export const QuoteResult = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  fromAmount: z.string(),
  toAmount: z.string(),
  rate: z.string(),
  priceImpact: z.string(),
  provider: z.string(),
  chain: z.string(),
  network: NetworkType,
  note: z.string(),
});

const quoteMeta = {
  description: 'Get a swap quote without executing. Same params as swap.',
  examples: [
    'await money.quote({ chain: "ethereum", from: "ETH", to: "USDC", amount: 1, network: "mainnet" })',
    'await money.quote({ chain: "solana", from: "SOL", to: "USDC", amount: 5, network: "mainnet" })',
  ],
  notes: 'Read-only preview of a swap. No transaction is executed.',
} as const;

// ─── bridge ──────────────────────────────────────────────────────────────────

export const BridgeParams = z.object({
  from: z.object({
    chain: z.string().describe('Source chain name'),
    token: z.string().describe('Token to bridge'),
  }).describe('Source chain and token'),
  to: z.object({
    chain: z.string().describe('Destination chain name'),
    token: z.string().optional().describe('Destination token (auto-resolved if omitted)'),
  }).describe('Destination chain'),
  amount: z.union([z.number(), z.string()]).describe('Amount to bridge in human units'),
  network: NetworkType.optional().describe('"mainnet" for DeBridge, "testnet" for OmniSet'),
  receiver: z.string().optional().describe('Destination address (defaults to your own wallet)'),
  provider: z.string().optional().describe('"debridge" or "omniset" — auto-selected by chain/network'),
});

export const BridgeResult = z.object({
  txHash: z.string(),
  explorerUrl: z.string(),
  fromChain: z.string(),
  toChain: z.string(),
  fromAmount: z.string(),
  toAmount: z.string(),
  orderId: z.string(),
  estimatedTime: z.string().optional(),
  note: z.string(),
});

const bridgeMeta = {
  description: 'Bridge tokens between chains.',
  examples: [
    'await money.bridge({ from: { chain: "fast", token: "SET" }, to: { chain: "ethereum" }, amount: 20, network: "testnet" })',
    'await money.bridge({ from: { chain: "ethereum", token: "WSET" }, to: { chain: "fast" }, amount: 5, network: "testnet" })',
    'await money.bridge({ from: { chain: "ethereum", token: "USDC" }, to: { chain: "base" }, amount: 100, network: "mainnet" })',
  ],
  notes: 'DeBridge for mainnet EVM/Solana bridging. OmniSet for testnet Fast↔EVM (Ethereum Sepolia, Arbitrum Sepolia). ERC-20 approvals handled automatically.',
} as const;

// ─── price ───────────────────────────────────────────────────────────────────

export const PriceParams = z.object({
  token: z.string().describe('Token symbol or contract address'),
  chain: z.string().optional().describe('Chain name — helps narrow results'),
  provider: z.string().optional().describe('Provider name (default: auto-selected)'),
});

export const PriceResult = z.object({
  price: z.string(),
  symbol: z.string(),
  name: z.string(),
  priceChange24h: z.string().optional(),
  volume24h: z.string().optional(),
  liquidity: z.string().optional(),
  marketCap: z.string().optional(),
  chain: z.string().optional(),
  note: z.string(),
});

const priceMeta = {
  description: 'Look up token price in USD.',
  examples: [
    'await money.price({ token: "ETH" })',
    'await money.price({ token: "SOL", chain: "solana" })',
    'await money.price({ token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chain: "ethereum" })',
  ],
  notes: 'Read-only. No setup required. Uses DexScreener for most chains, FastSet RPC for Fast chain tokens.',
} as const;

// ─── tokenInfo ───────────────────────────────────────────────────────────────

export const TokenInfoParams = z.object({
  token: z.string().describe('Token symbol or contract address'),
  chain: z.string().optional().describe('Chain name'),
  provider: z.string().optional().describe('Provider name'),
});

export const TokenInfoResult = z.object({
  name: z.string(),
  symbol: z.string(),
  address: z.string(),
  decimals: z.number().optional(),
  price: z.string(),
  priceChange24h: z.string().optional(),
  volume24h: z.string().optional(),
  liquidity: z.string().optional(),
  marketCap: z.string().optional(),
  pairs: z.array(z.object({
    dex: z.string(),
    pairAddress: z.string(),
    quoteToken: z.string(),
    price: z.string(),
  })),
  admin: z.string().optional(),
  minters: z.array(z.string()).optional(),
  totalSupply: z.string().optional(),
  chain: z.string().optional(),
  note: z.string(),
});

const tokenInfoMeta = {
  description: 'Get detailed token info including price and DEX pairs.',
  examples: [
    'await money.tokenInfo({ token: "USDC", chain: "ethereum" })',
    'await money.tokenInfo({ token: "SOL" })',
  ],
  notes: 'Superset of price(). Includes DEX pair data. For Fast chain tokens, also returns admin and minters.',
} as const;

// ─── sign ────────────────────────────────────────────────────────────────────

export const SignParams = z.object({
  chain: z.string().describe('Chain name'),
  message: z.union([z.string(), z.instanceof(Uint8Array)]).describe('Message to sign (string or bytes)'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

export const SignResult = z.object({
  signature: z.string(),
  address: z.string(),
  chain: z.string(),
  network: NetworkType,
  note: z.string(),
});

const signMeta = {
  description: 'Sign a message with your wallet key.',
  examples: [
    'await money.sign({ chain: "fast", message: "hello world" })',
    'await money.sign({ chain: "ethereum", message: "verify me" })',
  ],
  notes: 'Output format: EVM → 0x-prefixed hex, Solana → base58, Fast → hex. Use verifySign() to verify.',
} as const;

// ─── verifySign ──────────────────────────────────────────────────────────────

export const VerifySignParams = z.object({
  chain: z.string().describe('Chain name'),
  message: z.union([z.string(), z.instanceof(Uint8Array)]).describe('Original message'),
  signature: z.string().describe('Signature to verify'),
  address: z.string().describe('Expected signer address'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

export const VerifySignResult = z.object({
  valid: z.boolean(),
  address: z.string(),
  chain: z.string(),
  network: NetworkType,
  note: z.string(),
});

const verifySignMeta = {
  description: 'Verify a message signature.',
  examples: [
    'await money.verifySign({ chain: "fast", message: "hello", signature: "ab12...", address: "set1abc..." })',
    'await money.verifySign({ chain: "ethereum", message: "verify me", signature: "0xabc...", address: "0x123..." })',
  ],
  notes: 'Returns { valid: true } if the signature matches the address for the given message.',
} as const;

// ─── getToken ────────────────────────────────────────────────────────────────

export const GetTokenParams = z.object({
  chain: z.string().describe('Chain name'),
  name: z.string().describe('Token name/symbol to look up'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

const getTokenMeta = {
  description: 'Look up a registered token alias.',
  examples: [
    'await money.getToken({ chain: "ethereum", name: "USDC" })',
    'await money.getToken({ chain: "solana", name: "USDC" })',
  ],
  notes: 'Returns null if the token is not registered. Use registerToken() to add custom tokens.',
} as const;

// ─── registerToken ───────────────────────────────────────────────────────────

export const RegisterTokenParams = z.object({
  chain: z.string().describe('Chain name'),
  name: z.string().describe('Token alias (e.g. "USDC")'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
  address: z.string().optional().describe('EVM contract address'),
  mint: z.string().optional().describe('Solana SPL mint address'),
  decimals: z.number().optional().describe('Token decimals'),
});

const registerTokenMeta = {
  description: 'Register a custom token alias for use in balance/send.',
  examples: [
    'await money.registerToken({ chain: "base", name: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 })',
    'await money.registerToken({ chain: "solana", name: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 })',
  ],
  notes: 'Persists across sessions. Use getToken() to verify.',
} as const;

// ─── identifyChains ──────────────────────────────────────────────────────────

export const IdentifyChainsParams = z.object({
  address: z.string().describe('Any blockchain address'),
});

export const IdentifyChainsResult = z.object({
  chains: z.array(z.string()),
  note: z.string(),
});

const identifyChainsMeta = {
  description: 'Detect which blockchain(s) an address belongs to.',
  examples: [
    'await money.identifyChains({ address: "0x1234abcd..." })',
    'await money.identifyChains({ address: "set1abc..." })',
  ],
  notes: 'Pattern-based detection. Does not verify on-chain. EVM addresses match all 11 EVM chains.',
} as const;

// ─── history ─────────────────────────────────────────────────────────────────

export const HistoryParams = z.object({
  chain: z.string().optional().describe('Filter by chain name'),
  network: NetworkType.optional().describe('Filter by network'),
  limit: z.number().optional().describe('Max entries to return (default 50)'),
});

export const HistoryResult = z.object({
  entries: z.array(z.object({
    ts: z.string(),
    chain: z.string(),
    network: NetworkType,
    to: z.string(),
    amount: z.string(),
    token: z.string(),
    txHash: z.string(),
  })),
  note: z.string(),
});

const historyMeta = {
  description: 'View past send/bridge transactions.',
  examples: [
    'await money.history()',
    'await money.history({ chain: "fast", limit: 10 })',
    'await money.history({ network: "mainnet" })',
  ],
  notes: 'Local history only. Includes sends and bridges.',
} as const;

// ─── exportKeys ──────────────────────────────────────────────────────────────

export const ExportKeysParams = z.object({
  chain: z.string().describe('Chain name'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

export const ExportKeysResult = z.object({
  address: z.string(),
  privateKey: z.string(),
  keyfile: z.string(),
  chain: z.string(),
  chainType: z.enum(['evm', 'solana', 'fast']),
  note: z.string(),
});

const exportKeysMeta = {
  description: 'Export wallet private key for backup or import into another wallet.',
  examples: [
    'await money.exportKeys({ chain: "ethereum" })',
    'await money.exportKeys({ chain: "fast" })',
  ],
  notes: 'SENSITIVE — handle the private key securely. Never log or share it.',
} as const;

// ─── setApiKey ───────────────────────────────────────────────────────────────

export const SetApiKeyParams = z.object({
  provider: z.string().describe('Provider name (e.g. "jupiter")'),
  apiKey: z.string().describe('The API key'),
});

const setApiKeyMeta = {
  description: 'Set an API key for a provider.',
  examples: [
    'await money.setApiKey({ provider: "jupiter", apiKey: "your-key-here" })',
  ],
  notes: 'Required for Jupiter (Solana swaps). Free key from portal.jup.ag. Persists across sessions.',
} as const;

// ─── registerEvmChain ────────────────────────────────────────────────────────

export const RegisterEvmChainParams = z.object({
  chain: z.string().describe('Custom chain name (e.g. "my-l2")'),
  chainId: z.number().describe('EVM chain ID'),
  rpc: z.string().describe('RPC endpoint URL'),
  explorer: z.string().optional().describe('Block explorer URL (e.g. "https://etherscan.io/tx/")'),
  defaultToken: z.string().optional().describe('Native token symbol (defaults to "ETH")'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
});

const registerEvmChainMeta = {
  description: 'Register a custom EVM-compatible chain at runtime.',
  examples: [
    'await money.registerEvmChain({ chain: "my-l2", chainId: 12345, rpc: "https://rpc.my-l2.io" })',
    'await money.registerEvmChain({ chain: "my-l2", chainId: 12345, rpc: "https://rpc.my-l2.io", explorer: "https://scan.my-l2.io/tx/", defaultToken: "MYC" })',
  ],
  notes: 'After registering, use the chain name in setup/balance/send like any built-in chain.',
} as const;

// ─── toRawUnits ──────────────────────────────────────────────────────────────

export const ParseUnitsParams = z.object({
  amount: z.union([z.number(), z.string()]).describe('Human-readable amount (e.g. 1.5)'),
  chain: z.string().optional().describe('Chain name — for decimal lookup'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
  token: z.string().optional().describe('Token name — for decimal lookup'),
  decimals: z.number().optional().describe('Explicit decimals (skips token lookup)'),
});

const toRawUnitsMeta = {
  description: 'Convert human-readable amount to raw units (bigint).',
  examples: [
    'await money.toRawUnits({ amount: 1.5, decimals: 18 })  // → 1500000000000000000n',
    'await money.toRawUnits({ amount: 25, token: "USDC", chain: "ethereum" })  // → 25000000n',
  ],
  notes: 'Provide either decimals explicitly, or chain + token for automatic lookup.',
} as const;

// ─── toHumanUnits ────────────────────────────────────────────────────────────

export const FormatUnitsParams = z.object({
  amount: z.union([z.bigint(), z.number(), z.string()]).describe('Raw amount (bigint, number, or string)'),
  chain: z.string().optional().describe('Chain name'),
  network: NetworkType.optional().describe('Defaults to "testnet"'),
  token: z.string().optional().describe('Token name'),
  decimals: z.number().optional().describe('Explicit decimals'),
});

const toHumanUnitsMeta = {
  description: 'Convert raw units (bigint) to human-readable string.',
  examples: [
    'await money.toHumanUnits({ amount: 1500000000000000000n, decimals: 18 })  // → "1.5"',
    'await money.toHumanUnits({ amount: "25000000", token: "USDC", chain: "ethereum" })  // → "25"',
  ],
  notes: 'Inverse of toRawUnits.',
} as const;

// ─── registerSwapProvider ────────────────────────────────────────────────────

const registerSwapProviderMeta = {
  description: 'Register a custom swap provider.',
  examples: [
    'money.registerSwapProvider({ name: "my-dex", chains: ["ethereum"], quote: async (p) => { ... }, swap: async (p) => { ... } })',
  ],
  notes: 'Built-in: Jupiter (Solana), Paraswap (EVM). Custom providers override by name.',
} as const;

// ─── registerBridgeProvider ──────────────────────────────────────────────────

const registerBridgeProviderMeta = {
  description: 'Register a custom bridge provider.',
  examples: [
    'money.registerBridgeProvider({ name: "my-bridge", chains: ["ethereum", "base"], bridge: async (p) => { ... } })',
  ],
  notes: 'Built-in: DeBridge (mainnet EVM/Solana), OmniSet (testnet Fast↔EVM).',
} as const;

// ─── registerPriceProvider ───────────────────────────────────────────────────

const registerPriceProviderMeta = {
  description: 'Register a custom price provider.',
  examples: [
    'money.registerPriceProvider({ name: "my-oracle", getPrice: async (token) => { ... } })',
  ],
  notes: 'Built-in: DexScreener (most chains), FastSet RPC (Fast chain).',
} as const;

// ─── help ────────────────────────────────────────────────────────────────────

const helpMeta = {
  description: 'List all available SDK methods with brief descriptions.',
  examples: [
    'money.help()',
  ],
  notes: 'Use money.describe("methodName") for detailed info on any method.',
} as const;

// ─── describe ────────────────────────────────────────────────────────────────

const describeMeta = {
  description: 'Get detailed docs for a specific method including params, result, examples, and notes.',
  examples: [
    'money.describe("bridge")',
    'money.describe("setup")',
    'money.describe("swap")',
  ],
  notes: 'Returns null if the method name is not found. Use money.help() to see all methods.',
} as const;

// ─── Method schema entry ─────────────────────────────────────────────────────

export interface MethodEntry {
  params: z.ZodObject<z.ZodRawShape> | null;
  result: z.ZodObject<z.ZodRawShape> | null;
  description: string;
  examples: readonly string[];
  notes: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const METHOD_SCHEMAS: Record<string, MethodEntry> = {
  setup:                 { params: SetupParams,            result: SetupResult,          ...setupMeta },
  status:                { params: null,                   result: StatusResult,         ...statusMeta },
  balance:               { params: BalanceParams,          result: BalanceResult,        ...balanceMeta },
  send:                  { params: SendParams,             result: SendResult,           ...sendMeta },
  faucet:                { params: FaucetParams,           result: FaucetResult,         ...faucetMeta },
  tokens:                { params: TokensParams,           result: TokensResult,         ...tokensMeta },
  swap:                  { params: SwapParams,             result: SwapResult,           ...swapMeta },
  quote:                 { params: SwapParams,             result: QuoteResult,          ...quoteMeta },
  bridge:                { params: BridgeParams,           result: BridgeResult,         ...bridgeMeta },
  price:                 { params: PriceParams,            result: PriceResult,          ...priceMeta },
  tokenInfo:             { params: TokenInfoParams,        result: TokenInfoResult,      ...tokenInfoMeta },
  sign:                  { params: SignParams,             result: SignResult,            ...signMeta },
  verifySign:            { params: VerifySignParams,       result: VerifySignResult,     ...verifySignMeta },
  getToken:              { params: GetTokenParams,         result: null,                 ...getTokenMeta },
  registerToken:         { params: RegisterTokenParams,    result: null,                 ...registerTokenMeta },
  identifyChains:        { params: IdentifyChainsParams,   result: IdentifyChainsResult, ...identifyChainsMeta },
  history:               { params: HistoryParams,          result: HistoryResult,        ...historyMeta },
  exportKeys:            { params: ExportKeysParams,       result: ExportKeysResult,     ...exportKeysMeta },
  setApiKey:             { params: SetApiKeyParams,        result: null,                 ...setApiKeyMeta },
  registerEvmChain:      { params: RegisterEvmChainParams, result: null,                 ...registerEvmChainMeta },
  toRawUnits:            { params: ParseUnitsParams,       result: null,                 ...toRawUnitsMeta },
  toHumanUnits:          { params: FormatUnitsParams,      result: null,                 ...toHumanUnitsMeta },
  registerSwapProvider:  { params: null,                   result: null,                 ...registerSwapProviderMeta },
  registerBridgeProvider:{ params: null,                   result: null,                 ...registerBridgeProviderMeta },
  registerPriceProvider: { params: null,                   result: null,                 ...registerPriceProviderMeta },
  help:                  { params: null,                   result: null,                 ...helpMeta },
  describe:              { params: null,                   result: null,                 ...describeMeta },
};

// ─── Introspection helpers ───────────────────────────────────────────────────

/** Get the human-readable type name from a Zod schema field. */
function getZodTypeName(field: z.ZodTypeAny): string {
  // Zod v4 uses _def.type; v3 uses _def.typeName. Support both.
  const def = (field as unknown as {
    _def: {
      type?: string;
      typeName?: string;
      innerType?: z.ZodTypeAny;
      options?: z.ZodTypeAny[];
      types?: z.ZodTypeAny[];
      entries?: Record<string, string>;
      values?: string[];
    };
  })._def;
  const typeName = def?.type ?? def?.typeName;

  if (typeName === 'optional' || typeName === 'ZodOptional') {
    if (def.innerType) return getZodTypeName(def.innerType);
  }
  if (typeName === 'union' || typeName === 'ZodUnion') {
    const types = (def.options ?? def.types) as z.ZodTypeAny[] | undefined;
    if (types) return types.map(getZodTypeName).join(' | ');
  }
  if (typeName === 'enum' || typeName === 'ZodEnum') {
    // v4: _def.entries is Record<string, string>, v3: _def.values is string[]
    const entries = def.entries;
    if (entries) return Object.keys(entries).map((v: string) => `"${v}"`).join(' | ');
    const vals = def.values;
    if (vals) return vals.map((v: string) => `"${v}"`).join(' | ');
  }
  if (typeName === 'array' || typeName === 'ZodArray') return 'array';
  if (typeName === 'object' || typeName === 'ZodObject') return 'object';
  if (typeName === 'string' || typeName === 'ZodString') return 'string';
  if (typeName === 'number' || typeName === 'ZodNumber') return 'number';
  if (typeName === 'boolean' || typeName === 'ZodBoolean') return 'boolean';
  if (typeName === 'bigint' || typeName === 'ZodBigInt') return 'bigint';
  if ((typeName === 'effects' || typeName === 'ZodEffects') && def.innerType) {
    return getZodTypeName(def.innerType);
  }
  if (typeName === 'custom' || typeName === 'ZodCustom') return 'Uint8Array';
  return typeName ?? 'unknown';
}

/** Extract field description, checking both outer and inner type. */
function getFieldDescription(field: z.ZodTypeAny): string {
  const desc = field.description;
  if (desc) return desc;
  const def = (field as unknown as { _def: { innerType?: z.ZodTypeAny } })._def;
  return def?.innerType?.description ?? '';
}

/** Build "{ chain, network?, rpc? }" from a ZodObject. */
export function schemaToParamString(schema: z.ZodObject<z.ZodRawShape>): string {
  const fields = Object.entries(schema.shape).map(([k, v]) => {
    const field = v as z.ZodTypeAny;
    return field.isOptional() ? `${k}?` : k;
  });
  return `{ ${fields.join(', ')} }`;
}

/** Build "{ chain, address, note }" from a ZodObject result schema. */
export function schemaToResultString(schema: z.ZodObject<z.ZodRawShape>): string {
  const fields = Object.entries(schema.shape).map(([k, v]) => {
    const field = v as z.ZodTypeAny;
    return field.isOptional() ? `${k}?` : k;
  });
  return `{ ${fields.join(', ')} }`;
}

/** Build param details: { chain: "string — Chain name (...)" } */
export function schemaToParamDetails(schema: z.ZodObject<z.ZodRawShape>): Record<string, string> {
  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    const field = value as z.ZodTypeAny;
    const typeName = getZodTypeName(field);
    const desc = getFieldDescription(field);
    const opt = field.isOptional() ? ' (optional)' : '';
    details[key] = desc ? `${typeName}${opt} — ${desc}` : `${typeName}${opt}`;
  }
  return details;
}

/**
 * providers/types.ts — Provider interfaces for swap, bridge, and price
 *
 * Built-in providers (Jupiter, Paraswap, DeBridge, DexScreener) implement these.
 * Agents can register custom providers via money.registerSwapProvider() etc.
 */

/** Quote result returned by swap providers */
export interface SwapQuote {
  fromToken: string;       // resolved address
  toToken: string;         // resolved address
  fromAmount: string;      // raw units (string to avoid bigint serialization)
  toAmount: string;        // raw units
  fromAmountHuman: string; // human-readable
  toAmountHuman: string;   // human-readable
  priceImpact: string;     // percentage as string e.g. "0.12"
  route: unknown;          // opaque — passed back to swap() for execution
  provider: string;        // which provider generated this quote
}

/** Transaction executor for EVM chains — handles signing, sending, confirmation, and ERC-20 approvals */
export interface EvmTxExecutor {
  /** Send a transaction, wait for on-chain confirmation, return receipt */
  sendTx(tx: { to: string; data: string; value: string; gas?: string }): Promise<{ txHash: string; status: 'success' | 'reverted' }>;
  /** Check current ERC-20 allowance for spender */
  checkAllowance(token: string, spender: string, owner: string): Promise<bigint>;
  /** Approve ERC-20 spending, wait for confirmation, return approval tx hash */
  approveErc20(token: string, spender: string, amount: string): Promise<string>;
}

/** Transaction executor for Solana — handles signing, sending, and confirmation */
export interface SolanaTxExecutor {
  /** Sign a serialized transaction, send it, wait for confirmation */
  signAndSend(txBytes: Uint8Array): Promise<{ txHash: string; status: 'success' | 'failed' }>;
}

/** Swap provider interface */
export interface SwapProvider {
  name: string;
  chains: string[];        // which chains this provider supports (e.g. ["solana"] or ["ethereum","base","polygon"...])
  quote(params: {
    chain: string;
    chainId?: number;         // EVM chain ID (for providers that need it)
    fromToken: string;        // resolved token address
    toToken: string;          // resolved token address
    fromDecimals: number;
    toDecimals: number;
    amount: string;           // raw units
    slippageBps: number;
    userAddress: string;
    apiKey?: string;           // for providers that need an API key (e.g. Jupiter)
  }): Promise<SwapQuote>;
  swap(params: {
    chain: string;
    chainId?: number;
    fromToken: string;
    toToken: string;
    fromDecimals: number;
    toDecimals: number;
    amount: string;           // raw units
    slippageBps: number;
    userAddress: string;
    route: unknown;           // from quote()
    evmExecutor?: EvmTxExecutor;
    solanaExecutor?: SolanaTxExecutor;
    apiKey?: string;           // for providers that need an API key (e.g. Jupiter)
  }): Promise<{ txHash: string }>;
}

/** Bridge provider interface */
export interface BridgeProvider {
  name: string;
  chains: string[];         // supported chains
  bridge(params: {
    fromChain: string;
    fromChainId?: number;
    toChain: string;
    toChainId?: number;
    fromToken: string;       // resolved address
    toToken: string;         // resolved address
    fromDecimals: number;
    amount: string;          // raw units
    senderAddress: string;
    receiverAddress: string;
    evmExecutor?: EvmTxExecutor;
    solanaExecutor?: SolanaTxExecutor;
    apiKey?: string;           // for providers that need an API key
  }): Promise<{
    txHash: string;
    orderId: string;         // for tracking bridge status
    estimatedTime?: string;  // e.g. "2-5 minutes"
  }>;
}

/** Price provider interface */
export interface PriceProvider {
  name: string;
  getPrice(params: {
    token: string;           // symbol or address
    chain?: string;
    apiKey?: string;         // for providers that need an API key
  }): Promise<{
    price: string;           // USD price
    symbol: string;
    name: string;
    priceChange24h?: string;
    volume24h?: string;
    liquidity?: string;
    marketCap?: string;
  }>;
  getTokenInfo?(params: {
    token: string;
    chain?: string;
    apiKey?: string;         // for providers that need an API key
  }): Promise<{
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
  }>;
}

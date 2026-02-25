/**
 * providers/paraswap.ts — Paraswap swap provider for EVM chains
 *
 * API docs: https://developers.paraswap.network
 * No API key required.
 */

import type { SwapProvider, SwapQuote } from './types.js';

const BASE_URL = 'https://api.paraswap.io';

/** Paraswap chain IDs — maps our chain names to numeric IDs */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  fantom: 250,
  zksync: 324,
  linea: 59144,
  scroll: 534352,
};

const SUPPORTED_CHAINS = Object.keys(CHAIN_IDS);

export const paraswapProvider: SwapProvider = {
  name: 'paraswap',
  chains: SUPPORTED_CHAINS,

  async quote(params): Promise<SwapQuote> {
    const chainId = params.chainId ?? CHAIN_IDS[params.chain];
    if (!chainId) {
      throw new Error(`Paraswap does not support chain "${params.chain}"`);
    }

    const url = new URL(`${BASE_URL}/prices`);
    url.searchParams.set('srcToken', params.fromToken);
    url.searchParams.set('srcDecimals', String(params.fromDecimals));
    url.searchParams.set('destToken', params.toToken);
    url.searchParams.set('destDecimals', String(params.toDecimals));
    url.searchParams.set('amount', params.amount);
    url.searchParams.set('network', String(chainId));
    url.searchParams.set('side', 'SELL');
    url.searchParams.set('version', '6.2');
    if (params.userAddress) {
      url.searchParams.set('userAddress', params.userAddress);
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Paraswap quote failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      priceRoute: {
        srcToken: string;
        destToken: string;
        srcAmount: string;
        destAmount: string;
        srcDecimals: number;
        destDecimals: number;
        gasCostUSD: string;
        side: string;
        hmac: string;
        bestRoute: unknown[];
        contractAddress: string;
        contractMethod: string;
      };
    };

    const pr = data.priceRoute;
    const fromAmountHuman = formatAmount(pr.srcAmount, pr.srcDecimals);
    const toAmountHuman = formatAmount(pr.destAmount, pr.destDecimals);

    // Estimate price impact from USD values if available
    const priceImpact = '0'; // Paraswap doesn't expose this directly in the quote

    return {
      fromToken: pr.srcToken,
      toToken: pr.destToken,
      fromAmount: pr.srcAmount,
      toAmount: pr.destAmount,
      fromAmountHuman,
      toAmountHuman,
      priceImpact,
      route: data.priceRoute, // pass full priceRoute back for building tx
      provider: 'paraswap',
    };
  },

  async swap(params): Promise<{ txHash: string }> {
    const chainId = params.chainId ?? CHAIN_IDS[params.chain];
    if (!chainId) throw new Error(`Paraswap does not support chain "${params.chain}"`);
    if (!params.evmExecutor) throw new Error('Paraswap swap requires evmExecutor');

    // Step 1: Build the transaction using the priceRoute from quote
    const buildRes = await fetch(`${BASE_URL}/transactions/${chainId}?ignoreChecks=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcToken: params.fromToken,
        destToken: params.toToken,
        srcAmount: params.amount,
        destAmount: (params.route as { destAmount: string }).destAmount,
        priceRoute: params.route,
        userAddress: params.userAddress,
        slippage: params.slippageBps,
      }),
    });

    if (!buildRes.ok) {
      const text = await buildRes.text();
      throw new Error(`Paraswap build tx failed (${buildRes.status}): ${text}`);
    }

    const txData = (await buildRes.json()) as {
      from: string;
      to: string;
      value: string;
      data: string;
      gas?: string;
      gasPrice?: string;
      chainId: number;
    };

    // Step 2: ERC-20 approval if not native token
    const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    if (params.fromToken.toLowerCase() !== NATIVE.toLowerCase()) {
      const spender = txData.to; // Paraswap's TokenTransferProxy
      const currentAllowance = await params.evmExecutor.checkAllowance(params.fromToken, spender, params.userAddress);
      if (currentAllowance < BigInt(params.amount)) {
        await params.evmExecutor.approveErc20(params.fromToken, spender, params.amount);
      }
    }

    // Step 3: Validate and send the swap transaction
    if (!txData.to) throw new Error('Paraswap returned empty transaction target');

    const receipt = await params.evmExecutor.sendTx({
      to: txData.to,
      data: txData.data,
      value: txData.value,
      gas: txData.gas,
    });

    if (receipt.status === 'reverted') {
      throw new Error(`Paraswap swap transaction reverted: ${receipt.txHash}`);
    }

    return { txHash: receipt.txHash };
  },
};

/** Format raw amount to human-readable string */
function formatAmount(raw: string, decimals: number): string {
  const num = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const frac = num % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

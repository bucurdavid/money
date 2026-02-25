/**
 * providers/jupiter.ts — Jupiter v6 swap provider for Solana
 *
 * API docs: https://station.jup.ag/docs/apis/swap-api
 * No API key required for v6.
 */

import type { SwapProvider, SwapQuote } from './types.js';

const BASE_URL = 'https://quote-api.jup.ag/v6';

export const jupiterProvider: SwapProvider = {
  name: 'jupiter',
  chains: ['solana'],

  async quote(params): Promise<SwapQuote> {
    const url = new URL(`${BASE_URL}/quote`);
    url.searchParams.set('inputMint', params.fromToken);
    url.searchParams.set('outputMint', params.toToken);
    url.searchParams.set('amount', params.amount); // raw lamports/smallest unit
    url.searchParams.set('slippageBps', String(params.slippageBps));

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jupiter quote failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      priceImpactPct: string;
      routePlan: unknown[];
    };

    // Compute human-readable amounts
    const fromAmountHuman = formatAmount(data.inAmount, params.fromDecimals);
    const toAmountHuman = formatAmount(data.outAmount, params.toDecimals);

    return {
      fromToken: data.inputMint,
      toToken: data.outputMint,
      fromAmount: data.inAmount,
      toAmount: data.outAmount,
      fromAmountHuman,
      toAmountHuman,
      priceImpact: data.priceImpactPct,
      route: data, // pass the entire quote response back for swap
      provider: 'jupiter',
    };
  },

  async swap(params): Promise<{ txHash: string }> {
    // Step 1: Get the swap transaction from Jupiter
    const swapRes = await fetch(`${BASE_URL}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: params.route,
        userPublicKey: params.userAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!swapRes.ok) {
      const text = await swapRes.text();
      throw new Error(`Jupiter swap failed (${swapRes.status}): ${text}`);
    }

    const swapData = (await swapRes.json()) as { swapTransaction: string };

    // Step 2: Decode the base64 transaction, sign it, and send
    const txBytes = Buffer.from(swapData.swapTransaction, 'base64');
    const signedTxBytes = await params.signTransaction(new Uint8Array(txBytes));

    // Step 3: Send via Solana RPC
    if (params.sendRawTransaction) {
      const txHash = await params.sendRawTransaction(signedTxBytes);
      return { txHash };
    }

    throw new Error('Jupiter swap requires sendRawTransaction callback');
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

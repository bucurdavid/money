/**
 * providers/jupiter.ts — Jupiter Metis Swap API provider for Solana
 *
 * API docs: https://dev.jup.ag/docs/apis/swap-api
 * API key required — get a free key at https://portal.jup.ag
 */

import type { SwapProvider, SwapQuote } from './types.js';

const BASE_URL = 'https://api.jup.ag/swap/v1';

/** Throw a helpful error when Jupiter returns 401 or 403 */
function throwApiKeyError(): never {
  throw new Error(
    'Jupiter API requires an API key. Get a free key at https://portal.jup.ag and set it:\n' +
      '  await money.setApiKey({ provider: "jupiter", apiKey: "your-key" })',
  );
}

export const jupiterProvider: SwapProvider = {
  name: 'jupiter',
  chains: ['solana'],

  async quote(params): Promise<SwapQuote> {
    const url = new URL(`${BASE_URL}/quote`);
    url.searchParams.set('inputMint', params.fromToken);
    url.searchParams.set('outputMint', params.toToken);
    url.searchParams.set('amount', params.amount); // raw lamports/smallest unit
    url.searchParams.set('slippageBps', String(params.slippageBps));
    url.searchParams.set('restrictIntermediateTokens', 'true');

    const res = await fetch(url.toString());

    if (res.status === 401 || res.status === 403) {
      throwApiKeyError();
    }

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
    // Build headers — include API key when available
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.apiKey) {
      headers['x-api-key'] = params.apiKey;
    }

    // Step 1: Get the swap transaction from Jupiter Metis API
    const swapRes = await fetch(`${BASE_URL}/swap`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userPublicKey: params.userAddress,
        quoteResponse: params.route,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'veryHigh',
            maxLamports: 1000000,
          },
        },
      }),
    });

    if (swapRes.status === 401 || swapRes.status === 403) {
      throwApiKeyError();
    }

    if (!swapRes.ok) {
      const text = await swapRes.text();
      throw new Error(`Jupiter swap failed (${swapRes.status}): ${text}`);
    }

    const swapData = (await swapRes.json()) as {
      swapTransaction: string;
      lastValidBlockHeight: number;
    };

    // Step 2: Decode the base64 transaction and execute via solanaExecutor
    const txBytes = Buffer.from(swapData.swapTransaction, 'base64');

    if (params.solanaExecutor) {
      const result = await params.solanaExecutor.signAndSend(new Uint8Array(txBytes));
      if (result.status === 'failed') {
        throw new Error(`Jupiter swap transaction failed: ${result.txHash}`);
      }
      return { txHash: result.txHash };
    }

    throw new Error('Jupiter swap requires solanaExecutor');
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

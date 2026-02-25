/**
 * providers/debridge.ts — DeBridge DLN bridge provider
 *
 * API docs: https://docs.dln.trade
 * No API key required.
 */

import type { BridgeProvider } from './types.js';

const BASE_URL = 'https://dln.debridge.finance/v1.0';

/** DeBridge chain IDs */
const DEBRIDGE_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
  linea: 59144,
  fantom: 250,
  solana: 7565164,
};

const SUPPORTED_CHAINS = Object.keys(DEBRIDGE_CHAIN_IDS);

export const debridgeProvider: BridgeProvider = {
  name: 'debridge',
  chains: SUPPORTED_CHAINS,

  async bridge(params): Promise<{ txHash: string; orderId: string; estimatedTime?: string }> {
    const srcChainId = params.fromChainId ?? DEBRIDGE_CHAIN_IDS[params.fromChain];
    const dstChainId = params.toChainId ?? DEBRIDGE_CHAIN_IDS[params.toChain];

    if (!srcChainId) {
      throw new Error(`DeBridge does not support source chain "${params.fromChain}"`);
    }
    if (!dstChainId) {
      throw new Error(`DeBridge does not support destination chain "${params.toChain}"`);
    }

    const srcToken = params.fromToken;
    const dstToken = params.toToken;

    const url = new URL(`${BASE_URL}/dln/order/create-tx`);
    url.searchParams.set('srcChainId', String(srcChainId));
    url.searchParams.set('srcChainTokenIn', srcToken);
    url.searchParams.set('srcChainTokenInAmount', params.amount);
    url.searchParams.set('dstChainId', String(dstChainId));
    url.searchParams.set('dstChainTokenOut', dstToken);
    url.searchParams.set('dstChainTokenOutRecipient', params.receiverAddress);
    url.searchParams.set('senderAddress', params.senderAddress);
    url.searchParams.set('prependOperatingExpenses', 'true');
    url.searchParams.set('dstChainTokenOutAmount', 'auto');
    url.searchParams.set('srcChainOrderAuthorityAddress', params.senderAddress);
    url.searchParams.set('srcChainRefundAddress', params.senderAddress);
    url.searchParams.set('dstChainOrderAuthorityAddress', params.receiverAddress);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeBridge create-tx failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      orderId: string;
      estimation: {
        srcChainTokenIn: { amount: string };
        dstChainTokenOut: { amount: string; recommendedAmount: string };
      };
      tx: {
        to: string;
        data: string;
        value: string;
      };
      fixFee?: string;
    };

    // Determine if this is EVM or Solana based on source chain
    const isSolanaSource = params.fromChain === 'solana';

    let txHash: string;

    if (isSolanaSource) {
      // Solana: tx.data is a base64-encoded transaction
      if (!params.solanaExecutor) {
        throw new Error('DeBridge Solana bridge requires solanaExecutor');
      }
      const txBytes = Buffer.from(data.tx.data, 'base64');
      const result = await params.solanaExecutor.signAndSend(new Uint8Array(txBytes));
      if (result.status === 'failed') {
        throw new Error(`DeBridge Solana bridge transaction failed: ${result.txHash}`);
      }
      txHash = result.txHash;
    } else {
      // EVM: use evmExecutor
      if (!params.evmExecutor) {
        throw new Error('DeBridge EVM bridge requires evmExecutor');
      }

      // Validate tx target
      if (!data.tx.to) {
        throw new Error('DeBridge returned empty transaction target. The API response may be incomplete.');
      }

      // ERC-20 approval if needed — the spender is tx.to (the DLN contract)
      const isNativeToken = params.fromToken === '0x0000000000000000000000000000000000000000';
      if (!isNativeToken) {
        const requiredAmount = BigInt(data.estimation.srcChainTokenIn.amount);
        const currentAllowance = await params.evmExecutor.checkAllowance(
          params.fromToken, data.tx.to, params.senderAddress
        );
        if (currentAllowance < requiredAmount) {
          await params.evmExecutor.approveErc20(
            params.fromToken, data.tx.to, data.estimation.srcChainTokenIn.amount
          );
        }
      }

      const receipt = await params.evmExecutor.sendTx({
        to: data.tx.to,
        data: data.tx.data,
        value: data.tx.value,
      });

      if (receipt.status === 'reverted') {
        throw new Error(`DeBridge bridge transaction reverted: ${receipt.txHash}`);
      }

      txHash = receipt.txHash;
    }

    return {
      txHash,
      orderId: data.orderId ?? txHash,
      estimatedTime: '1-5 minutes',
    };
  },
};

/** Check bridge order status */
export async function checkBridgeStatus(orderId: string): Promise<{
  status: string;
  srcTxHash?: string;
  dstTxHash?: string;
}> {
  const res = await fetch(`${BASE_URL}/dln/order/${orderId}/status`);
  if (!res.ok) {
    throw new Error(`DeBridge status check failed (${res.status})`);
  }
  const data = (await res.json()) as {
    status: string;
    fulfilledDstEventMetadata?: { transactionHash?: { stringValue?: string } };
  };
  return {
    status: data.status,
    dstTxHash: data.fulfilledDstEventMetadata?.transactionHash?.stringValue,
  };
}

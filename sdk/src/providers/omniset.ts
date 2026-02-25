/**
 * providers/omniset.ts — OmniSet bridge provider
 *
 * Bridges between FastSet and EVM chains (Ethereum Sepolia, Arbitrum Sepolia).
 *
 * Two directions:
 *   Deposit  (EVM → Fast): call bridge.deposit(token, amount, receiver) on the EVM bridge contract
 *   Withdraw (Fast → EVM): transfer on FastSet + submit ExternalClaim intent + POST to relayer
 */

import { bech32m } from 'bech32';
import { encodeFunctionData, encodeAbiParameters, hashMessage } from 'viem';
import type { BridgeProvider } from './types.js';
import { MoneyError } from '../errors.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Decode base64 to Uint8Array */
function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** FastSet token IDs */
const WETH_FASTSET_TOKEN_ID = base64ToBytes('W6YWYjF5vVWnczFBJVAy+OEyh2ACG+lhZtO8FF8h5jo=');
const SET_FASTSET_TOKEN_ID = base64ToBytes('+ldecAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

// ─── Chain configuration ──────────────────────────────────────────────────────

/** Per-chain bridge configuration */
interface OmnisetChainConfig {
  chainId: number;
  bridgeContract: string;
  wsetAddress: string;
  wethAddress: string;
  fastsetBridgeAddress: string;  // bech32m address of the bridge account on FastSet
  relayerUrl: string;
}

const CHAIN_CONFIGS: Record<string, OmnisetChainConfig> = {
  ethereum: {
    chainId: 11155111,
    bridgeContract: '0xaBe4A90B23738EE0d56425825cF20C63C578e75a',
    wsetAddress: '0x485DdBAa2D62ee70D03B4789912948f3aF7E35B8',
    wethAddress: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    fastsetBridgeAddress: 'set1la44katfwdhv9tqvskjrjc5cmy7ufjwvufwz4suuvazua5dtf4js08rgrz',
    relayerUrl: 'https://omniset.fastset.xyz/ethereum-sepolia-relayer/relay',
  },
  arbitrum: {
    chainId: 421614,
    bridgeContract: '0x485DdBAa2D62ee70D03B4789912948f3aF7E35B8',
    wsetAddress: '0xA0431d49B71c6f07603272C6C580560AfF41598E',
    wethAddress: '0x980b62da83eff3d4576c647993b0c1d7faf17c73',
    fastsetBridgeAddress: 'set1la4pjzupsdwwgx3vu0fvvl6hk4ts3psg2d4g3mlq5yxwqhdjl03sp7ek2u',
    relayerUrl: 'https://omniset.fastset.xyz/arbitrum-sepolia-relayer/relay',
  },
};

// ─── Token registry ───────────────────────────────────────────────────────────

/** Token info for resolution */
interface OmnisetTokenInfo {
  evmAddress: string;
  fastsetTokenId: Uint8Array;
  decimals: number;
  isNative: boolean;
}

/** Token registry per EVM chain */
const CHAIN_TOKENS: Record<string, Record<string, OmnisetTokenInfo>> = {
  ethereum: {
    ETH: { evmAddress: ZERO_ADDRESS, fastsetTokenId: WETH_FASTSET_TOKEN_ID, decimals: 18, isNative: true },
    WETH: { evmAddress: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', fastsetTokenId: WETH_FASTSET_TOKEN_ID, decimals: 18, isNative: false },
    WSET: { evmAddress: '0x485DdBAa2D62ee70D03B4789912948f3aF7E35B8', fastsetTokenId: SET_FASTSET_TOKEN_ID, decimals: 18, isNative: false },
    SET: { evmAddress: '0x485DdBAa2D62ee70D03B4789912948f3aF7E35B8', fastsetTokenId: SET_FASTSET_TOKEN_ID, decimals: 18, isNative: false },
  },
  arbitrum: {
    ETH: { evmAddress: ZERO_ADDRESS, fastsetTokenId: WETH_FASTSET_TOKEN_ID, decimals: 18, isNative: true },
    WETH: { evmAddress: '0x980b62da83eff3d4576c647993b0c1d7faf17c73', fastsetTokenId: WETH_FASTSET_TOKEN_ID, decimals: 18, isNative: false },
    WSET: { evmAddress: '0xA0431d49B71c6f07603272C6C580560AfF41598E', fastsetTokenId: SET_FASTSET_TOKEN_ID, decimals: 18, isNative: false },
    SET: { evmAddress: '0xA0431d49B71c6f07603272C6C580560AfF41598E', fastsetTokenId: SET_FASTSET_TOKEN_ID, decimals: 18, isNative: false },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a token symbol or address to OmnisetTokenInfo for a given EVM chain.
 * Handles symbols (ETH, WETH, WSET, SET), setXXX prefixes (setWETH → WETH),
 * and raw EVM addresses.
 */
function resolveOmnisetToken(token: string, evmChain: string): OmnisetTokenInfo | null {
  const chainTokens = CHAIN_TOKENS[evmChain];
  if (!chainTokens) return null;

  // Try by symbol (case-insensitive)
  const upper = token.toUpperCase();
  if (chainTokens[upper]) return chainTokens[upper]!;

  // For Fast-side tokens: setWETH → WETH, setWSET → WSET
  if (upper.startsWith('SET') && upper.length > 3) {
    const stripped = upper.slice(3);
    if (chainTokens[stripped]) return chainTokens[stripped]!;
  }

  // Try by EVM address
  for (const info of Object.values(chainTokens)) {
    if (info.evmAddress.toLowerCase() === token.toLowerCase()) return info;
  }

  return null;
}

/**
 * Convert a FastSet bech32m address (set1...) to a bytes32 hex string
 * suitable for passing to the bridge deposit() function.
 */
function fastAddressToBytes32(address: string): `0x${string}` {
  const { words } = bech32m.decode(address, 90);
  const bytes = new Uint8Array(bech32m.fromWords(words));
  return `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`;
}

/**
 * Convert a hex string (with or without 0x prefix) to a Uint8Array.
 */
function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── ABI ──────────────────────────────────────────────────────────────────────

const BRIDGE_DEPOSIT_ABI = [{
  type: 'function' as const,
  name: 'deposit' as const,
  inputs: [
    { name: 'token', type: 'address' as const },
    { name: 'amount', type: 'uint256' as const },
    { name: 'receiver', type: 'bytes32' as const },
  ],
  outputs: [],
  stateMutability: 'payable' as const,
}];

// ─── Provider ─────────────────────────────────────────────────────────────────

export const omnisetProvider: BridgeProvider = {
  name: 'omniset',
  chains: ['fast', 'ethereum', 'arbitrum'],
  networks: ['testnet'],

  async bridge(params): Promise<{ txHash: string; orderId: string; estimatedTime?: string }> {
    try {
      const isDeposit = params.fromChain !== 'fast' && params.toChain === 'fast';
      const isWithdraw = params.fromChain === 'fast';

      if (!isDeposit && !isWithdraw) {
        throw new MoneyError(
          'UNSUPPORTED_OPERATION',
          `OmniSet only supports bridging between FastSet and EVM chains (ethereum, arbitrum). Got: ${params.fromChain} → ${params.toChain}`,
          {
            note: 'Use fromChain: "fast" for withdrawals, or toChain: "fast" for deposits.\n  Example: await money.bridge({ from: { chain: "ethereum", token: "ETH" }, to: { chain: "fast" }, amount: 0.01, network: "testnet" })',
          },
        );
      }

      // ─── Deposit: EVM → Fast ────────────────────────────────────────────────

      if (isDeposit) {
        if (!params.evmExecutor) {
          throw new MoneyError(
            'INVALID_PARAMS',
            'OmniSet deposit (EVM → Fast) requires evmExecutor',
            {
              chain: params.fromChain,
              note: 'The evmExecutor is provided automatically when using money.bridge(). Ensure the source chain is configured:\n  await money.setup({ chain: "ethereum", network: "testnet" })',
            },
          );
        }

        const chainConfig = CHAIN_CONFIGS[params.fromChain];
        if (!chainConfig) {
          throw new MoneyError(
            'UNSUPPORTED_OPERATION',
            `OmniSet does not support EVM chain "${params.fromChain}". Supported: ${Object.keys(CHAIN_CONFIGS).join(', ')}`,
            {
              chain: params.fromChain,
              note: 'Use "ethereum" or "arbitrum" as the source chain for OmniSet deposits.',
            },
          );
        }

        // Resolve token — try fromToken first, then toToken as fallback
        let tokenInfo = resolveOmnisetToken(params.fromToken, params.fromChain);
        if (!tokenInfo) {
          tokenInfo = resolveOmnisetToken(params.toToken, params.fromChain);
        }
        if (!tokenInfo) {
          throw new MoneyError(
            'TOKEN_NOT_FOUND',
            `Cannot resolve token "${params.fromToken}" on OmniSet for chain "${params.fromChain}".`,
            {
              chain: params.fromChain,
              note: `Supported tokens: ETH, WETH, WSET, SET.\n  Example: await money.bridge({ from: { chain: "ethereum", token: "ETH" }, to: { chain: "fast" }, amount: 0.01, network: "testnet" })`,
            },
          );
        }

        // Convert receiver bech32m address to bytes32
        let receiverBytes32: `0x${string}`;
        try {
          receiverBytes32 = fastAddressToBytes32(params.receiverAddress);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new MoneyError(
            'INVALID_ADDRESS',
            `Failed to decode FastSet receiver address "${params.receiverAddress}": ${msg}`,
            {
              note: 'The receiver address must be a valid FastSet bech32m address (set1...).\n  Example: set1abc...',
            },
          );
        }

        // Build deposit calldata
        const calldata = encodeFunctionData({
          abi: BRIDGE_DEPOSIT_ABI,
          functionName: 'deposit',
          args: [
            tokenInfo.evmAddress as `0x${string}`,
            BigInt(params.amount),
            receiverBytes32,
          ],
        });

        let txHash: string;

        if (tokenInfo.isNative) {
          // Native ETH: send value with the call
          const receipt = await params.evmExecutor.sendTx({
            to: chainConfig.bridgeContract,
            data: calldata,
            value: params.amount,
          });
          if (receipt.status === 'reverted') {
            throw new MoneyError(
              'TX_FAILED',
              `OmniSet deposit transaction reverted: ${receipt.txHash}`,
              {
                chain: params.fromChain,
                note: 'The deposit transaction was reverted. Check that you have sufficient ETH balance.',
              },
            );
          }
          txHash = receipt.txHash;
        } else {
          // ERC-20: check allowance, approve if needed, then deposit
          const requiredAmount = BigInt(params.amount);
          const currentAllowance = await params.evmExecutor.checkAllowance(
            tokenInfo.evmAddress,
            chainConfig.bridgeContract,
            params.senderAddress,
          );
          if (currentAllowance < requiredAmount) {
            await params.evmExecutor.approveErc20(
              tokenInfo.evmAddress,
              chainConfig.bridgeContract,
              params.amount,
            );
          }

          const receipt = await params.evmExecutor.sendTx({
            to: chainConfig.bridgeContract,
            data: calldata,
            value: '0',
          });
          if (receipt.status === 'reverted') {
            throw new MoneyError(
              'TX_FAILED',
              `OmniSet deposit transaction reverted: ${receipt.txHash}`,
              {
                chain: params.fromChain,
                note: 'The deposit transaction was reverted. Check that you have sufficient token balance and the approval succeeded.',
              },
            );
          }
          txHash = receipt.txHash;
        }

        return {
          txHash,
          orderId: txHash,
          estimatedTime: '1-5 minutes',
        };
      }

      // ─── Withdraw: Fast → EVM ───────────────────────────────────────────────

      if (!params.fastExecutor) {
        throw new MoneyError(
          'INVALID_PARAMS',
          'OmniSet withdrawal (Fast → EVM) requires fastExecutor',
          {
            chain: 'fast',
            note: 'The fastExecutor is provided automatically when using money.bridge(). Ensure the Fast chain is configured:\n  await money.setup({ chain: "fast", network: "testnet" })',
          },
        );
      }

      const chainConfig = CHAIN_CONFIGS[params.toChain];
      if (!chainConfig) {
        throw new MoneyError(
          'UNSUPPORTED_OPERATION',
          `OmniSet does not support EVM destination chain "${params.toChain}". Supported: ${Object.keys(CHAIN_CONFIGS).join(', ')}`,
          {
            chain: params.toChain,
            note: 'Use "ethereum" or "arbitrum" as the destination chain for OmniSet withdrawals.',
          },
        );
      }

      // Resolve token — maps FastSet token name to EVM token info
      let tokenInfo = resolveOmnisetToken(params.fromToken, params.toChain);
      if (!tokenInfo) {
        tokenInfo = resolveOmnisetToken(params.toToken, params.toChain);
      }
      if (!tokenInfo) {
        throw new MoneyError(
          'TOKEN_NOT_FOUND',
          `Cannot resolve token "${params.fromToken}" on OmniSet for destination chain "${params.toChain}".`,
          {
            chain: params.toChain,
            note: `Supported tokens: setWETH (→ ETH/WETH), setWSET (→ WSET/SET).\n  Example: await money.bridge({ from: { chain: "fast", token: "setWETH" }, to: { chain: "ethereum" }, amount: 0.01, network: "testnet" })`,
          },
        );
      }

      // Determine the EVM token address for the relayer payload.
      // The bridge holds WETH (not native ETH), so native tokens map to wethAddress.
      const evmTokenAddress = tokenInfo.isNative
        ? chainConfig.wethAddress
        : tokenInfo.evmAddress;

      // Step 1 — Transfer tokens to the FastSet bridge account
      const transferResult = await params.fastExecutor.sendTokenTransfer(
        chainConfig.fastsetBridgeAddress,
        params.amount,
        tokenInfo.fastsetTokenId,
      );

      // Step 2 — Cross-sign the transfer certificate
      const transferCrossSign = await params.fastExecutor.evmSignCertificate(
        transferResult.certificate,
      );

      // Step 3 — Compute transferClaimHash (EIP-191 message hash of the signed transaction bytes)
      const transferClaimHash = hashMessage({
        raw: new Uint8Array(transferCrossSign.transaction),
      });

      // Step 4 — Build IntentClaim ABI-encoded bytes
      // DynamicTransfer payload: (tokenAddress, recipient)
      // For native ETH withdrawals, use wethAddress since the bridge holds WETH
      const dynamicTransferPayload = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }],
        [
          evmTokenAddress as `0x${string}`,
          params.receiverAddress as `0x${string}`,
        ],
      );

      // IntentClaim struct ABI encoding
      const intentClaimEncoded = encodeAbiParameters(
        [{
          type: 'tuple',
          components: [
            { name: 'transferClaimHash', type: 'bytes32' },
            {
              name: 'intents',
              type: 'tuple[]',
              components: [
                { name: 'action', type: 'uint8' },
                { name: 'payload', type: 'bytes' },
                { name: 'value', type: 'uint256' },
              ],
            },
          ],
        }],
        [{
          transferClaimHash: transferClaimHash as `0x${string}`,
          intents: [{
            action: 1,  // DynamicTransfer
            payload: dynamicTransferPayload,
            value: 0n,
          }],
        }],
      );

      // Convert hex-encoded ABI data to Uint8Array for ExternalClaim
      const intentBytes = hexToUint8Array(intentClaimEncoded);

      // Step 5 — Submit ExternalClaim (recipient = sender's own address)
      const intentResult = await params.fastExecutor.submitExternalClaim(
        params.fastExecutor.getAddress(),
        intentBytes,
      );

      // Step 6 — Cross-sign the intent certificate
      const intentCrossSign = await params.fastExecutor.evmSignCertificate(
        intentResult.certificate,
      );

      // Step 7 — POST to relayer
      const relayerBody = {
        encoded_transfer_claim: Array.from(new Uint8Array(transferCrossSign.transaction.map(Number))),
        transfer_proof: transferCrossSign.signature,
        transfer_claim_id: transferResult.txHash,
        fastset_address: params.senderAddress,
        external_address: params.receiverAddress,
        encoded_intent_claim: Array.from(new Uint8Array(intentCrossSign.transaction.map(Number))),
        intent_proof: intentCrossSign.signature,
        intent_claim_id: intentResult.txHash,
        external_token_address: evmTokenAddress,
      };

      const relayRes = await fetch(chainConfig.relayerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(relayerBody),
      });

      if (!relayRes.ok) {
        const text = await relayRes.text();
        throw new MoneyError(
          'TX_FAILED',
          `OmniSet relayer request failed (${relayRes.status}): ${text}`,
          {
            chain: 'fast',
            note: 'The withdrawal was submitted to FastSet but the relayer rejected it. Try again.',
          },
        );
      }

      return {
        txHash: transferResult.txHash,
        orderId: transferClaimHash,
        estimatedTime: '1-5 minutes',
      };
    } catch (err: unknown) {
      if (err instanceof MoneyError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new MoneyError(
        'TX_FAILED',
        `OmniSet bridge failed: ${msg}`,
        {
          note: 'Check that both chains are configured and have sufficient balance.',
        },
      );
    }
  },
};

/**
 * evm.ts — EVM chain adapter (Base, Ethereum, Arbitrum)
 *
 * Uses viem for all on-chain interactions.
 * Keys are managed via keys.ts helpers — private keys never leave withKey().
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
} from 'viem';
import { privateKeyToAccount, publicKeyToAddress } from 'viem/accounts';
import type { Chain, PublicClient } from 'viem';

import {
  generateSecp256k1Key,
  saveKeyfile,
  withKey,
  scrubKeyFromError,
} from '../keys.js';
import { MoneyError } from '../errors.js';
import type { ChainAdapter } from './adapter.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_DECIMALS = 18;

/** Minimal ERC-20 ABI for balanceOf and transfer */
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// ─── Faucet URLs ──────────────────────────────────────────────────────────────

const FAUCET_URLS: Record<string, string> = {
  base: 'https://www.coinbase.com/faucets/base-ethereum-goerli-faucet',
  ethereum: 'https://sepoliafaucet.com',
  arbitrum: 'https://faucet.arbitrum.io',
};

// ─── Address derivation ───────────────────────────────────────────────────────

/**
 * Derive an EVM address from an uncompressed secp256k1 public key.
 * Delegates to viem's publicKeyToAddress which handles keccak256 + EIP-55 checksum.
 */
function publicKeyToEvmAddress(uncompressedPubKeyHex: string): string {
  return publicKeyToAddress(`0x${uncompressedPubKeyHex}` as `0x${string}`);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createEvmAdapter(
  chainName: string,
  rpcUrl: string,
  explorerBaseUrl: string,
  tokens: Record<string, { address: string; decimals: number }>,
): ChainAdapter {
  // Create the publicClient once per adapter instance
  const publicClient: PublicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  // ─── setupWallet ────────────────────────────────────────────────────────────

  async function setupWallet(keyfilePath: string): Promise<{ address: string }> {
    // If a keyfile already exists, load and derive address without regenerating
    try {
      const address = await withKey(keyfilePath, async (kp) => {
        return publicKeyToEvmAddress(kp.publicKey);
      });
      return { address };
    } catch {
      // Keyfile doesn't exist yet — generate a new one
    }

    const keypair = await generateSecp256k1Key();
    await saveKeyfile(keyfilePath, keypair);
    const address = publicKeyToEvmAddress(keypair.publicKey);
    return { address };
  }

  // ─── getBalance ─────────────────────────────────────────────────────────────

  async function getBalance(
    address: string,
    token?: string,
  ): Promise<{ amount: string; token: string }> {
    const resolvedToken = token ?? 'ETH';
    const isNative = !resolvedToken || resolvedToken === 'ETH';

    if (isNative) {
      const raw = await publicClient.getBalance({
        address: address as `0x${string}`,
      });
      return {
        amount: formatUnits(raw, NATIVE_DECIMALS),
        token: 'ETH',
      };
    }

    // ERC-20 token
    const tokenConfig = tokens[resolvedToken];
    if (!tokenConfig) {
      throw new Error(
        `Token "${resolvedToken}" is not configured for chain "${chainName}".`,
      );
    }

    const raw = await publicClient.readContract({
      address: tokenConfig.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });

    return {
      amount: formatUnits(raw as bigint, tokenConfig.decimals),
      token: resolvedToken,
    };
  }

  // ─── send ────────────────────────────────────────────────────────────────────

  async function send(params: {
    from: string;
    to: string;
    amount: string;
    token?: string;
    memo?: string;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }> {
    const resolvedToken = params.token ?? 'ETH';
    const isNative = !resolvedToken || resolvedToken === 'ETH';

    try {
      const txHash = await withKey(params.keyfile, async (kp) => {
        const account = privateKeyToAccount(`0x${kp.privateKey}` as `0x${string}`);

        const walletClient = createWalletClient({
          account,
          transport: http(rpcUrl),
        });

        if (isNative) {
          const value = parseUnits(params.amount, NATIVE_DECIMALS);
          return walletClient.sendTransaction({
            to: params.to as `0x${string}`,
            value,
            chain: null as unknown as Chain,
          });
        }

        // ERC-20 transfer
        const tokenConfig = tokens[resolvedToken];
        if (!tokenConfig) {
          throw new Error(
            `Token "${resolvedToken}" is not configured for chain "${chainName}".`,
          );
        }

        const amount = parseUnits(params.amount, tokenConfig.decimals);
        return walletClient.writeContract({
          address: tokenConfig.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [params.to as `0x${string}`, amount],
          chain: null as unknown as Chain,
        });
      });

      return {
        txHash,
        explorerUrl: `${explorerBaseUrl}/tx/${txHash}`,
        fee: '0',
      };
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      const scrubbed = scrubKeyFromError(err);
      const msg = scrubbed instanceof Error ? scrubbed.message : String(scrubbed);
      if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
        throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: chainName });
      }
      throw new MoneyError('TX_FAILED', msg, { chain: chainName });
    }
  }

  // ─── faucet ──────────────────────────────────────────────────────────────────

  async function faucet(address: string): Promise<{ amount: string; token: string; txHash: string }> {
    const faucetUrl = FAUCET_URLS[chainName] ?? 'https://faucet.paradigm.xyz';
    throw new MoneyError('TX_FAILED',
      `No programmatic faucet for ${chainName}. Fund manually: ${faucetUrl}`,
      { chain: chainName, details: { faucetUrl } },
    );
  }

  // ─── Assemble adapter ────────────────────────────────────────────────────────

  return {
    chain: chainName,
    addressPattern: ADDRESS_PATTERN,
    setupWallet,
    getBalance,
    send,
    faucet,
  };
}

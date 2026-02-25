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
} from '../keys.js';
import { MoneyError } from '../errors.js';
import { fetchBlockscoutTokens } from '../providers/blockscout.js';
import type { ChainAdapter } from './adapter.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const NATIVE_DECIMALS = 18;

/** Minimal ERC-20 ABI for balanceOf, transfer, and decimals */
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
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

// ─── Faucet URLs ──────────────────────────────────────────────────────────────

const FAUCET_URLS: Record<string, string> = {
  base: 'https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet',
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
  aliases: Record<string, { address: string; decimals: number }>,
  viemChain: Chain,
  nativeSymbol: string = 'ETH',
): ChainAdapter {
  // Create the publicClient once per adapter instance
  const publicClient: PublicClient = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const decimalsCache = new Map<string, number>();

  // ─── resolveToken ───────────────────────────────────────────────────────────

  type ResolvedToken =
    | { type: 'native' }
    | { type: 'erc20'; address: string; decimals: number };

  async function resolveToken(token?: string): Promise<ResolvedToken> {
    const t = token ?? nativeSymbol;
    if (t === nativeSymbol) return { type: 'native' };

    // Raw ERC-20 address
    if (/^0x[0-9a-fA-F]{40}$/.test(t)) {
      let decimals = decimalsCache.get(t);
      if (decimals === undefined) {
        const raw = await publicClient.readContract({
          address: t as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'decimals',
          args: [],
        });
        decimals = typeof raw === 'bigint' ? Number(raw) : (raw as number);
        decimalsCache.set(t, decimals);
      }
      return { type: 'erc20', address: t, decimals };
    }

    // Named alias
    const aliasConfig = aliases[t];
    if (aliasConfig) {
      return { type: 'erc20', address: aliasConfig.address, decimals: aliasConfig.decimals };
    }

    throw new MoneyError('TOKEN_NOT_FOUND', `Token "${t}" is not configured for chain "${chainName}".`, { chain: chainName, note: `Register the token first:\n  await money.registerToken({ chain: "${chainName}", name: "${t}", address: "0x...", decimals: 18 })` });
  }

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
    const resolved = await resolveToken(token);

    if (resolved.type === 'native') {
      const raw = await publicClient.getBalance({ address: address as `0x${string}` });
      return { amount: formatUnits(raw, NATIVE_DECIMALS), token: nativeSymbol };
    }

    const raw = await publicClient.readContract({
      address: resolved.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });

    const label = token ?? resolved.address;
    return { amount: formatUnits(raw as bigint, resolved.decimals), token: label };
  }

  // ─── send ────────────────────────────────────────────────────────────────────

  async function send(params: {
    from: string;
    to: string;
    amount: string;
    token?: string;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }> {
    // Resolve token BEFORE entering withKey so errors propagate cleanly
    const resolved = await resolveToken(params.token);

    try {
      const txHash = await withKey(params.keyfile, async (kp) => {
        const account = privateKeyToAccount(`0x${kp.privateKey}` as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: viemChain,
          transport: http(rpcUrl),
        });

        if (resolved.type === 'native') {
          const value = parseUnits(params.amount, NATIVE_DECIMALS);
          return walletClient.sendTransaction({
            to: params.to as `0x${string}`,
            value,
            chain: viemChain,
          });
        }

        const amount = parseUnits(params.amount, resolved.decimals);
        return walletClient.writeContract({
          address: resolved.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [params.to as `0x${string}`, amount],
          chain: viemChain,
        });
      });

      let fee = '0';
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        fee = formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18);
      } catch {
        // Fall back to '0' if receipt fetch fails
      }

      return {
        txHash,
        explorerUrl: `${explorerBaseUrl}/tx/${txHash}`,
        fee,
      };
    } catch (err: unknown) {
      if (err instanceof MoneyError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
        throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: chainName, note: `Get tokens:\n  await money.faucet({ chain: "${chainName}" })` });
      }
      throw new MoneyError('TX_FAILED', msg, { chain: chainName, note: `Wait 5 seconds, then retry the send.` });
    }
  }

  // ─── faucet ──────────────────────────────────────────────────────────────────

  async function faucet(address: string): Promise<{ amount: string; token: string; txHash: string }> {
    const faucetUrl = FAUCET_URLS[chainName] ?? 'https://faucet.paradigm.xyz';
    throw new MoneyError('TX_FAILED',
      `No programmatic faucet for ${chainName}. Fund manually: ${faucetUrl}`,
      { chain: chainName, details: { faucetUrl }, note: `Open ${faucetUrl} to get testnet tokens, then check:\n  await money.balance({ chain: "${chainName}" })` },
    );
  }

  // ─── sign ─────────────────────────────────────────────────────────────────

  async function sign(params: {
    message: string | Uint8Array;
    keyfile: string;
  }): Promise<{ signature: string; address: string }> {
    return await withKey(params.keyfile, async (kp) => {
      const account = privateKeyToAccount(`0x${kp.privateKey}` as `0x${string}`);
      const signature = await account.signMessage({
        message: typeof params.message === 'string'
          ? params.message
          : { raw: params.message },
      });
      return { signature, address: account.address };
    });
  }

  // ─── ownedTokens ─────────────────────────────────────────────────────────────

  async function ownedTokens(address: string): Promise<Array<{
    symbol: string;
    address: string;
    balance: string;
    rawBalance: string;
    decimals: number;
  }>> {
    const tokens: Array<{ symbol: string; address: string; balance: string; rawBalance: string; decimals: number }> = [];

    // Native balance
    try {
      const raw = await publicClient.getBalance({ address: address as `0x${string}` });
      tokens.push({
        symbol: nativeSymbol,
        address: '0x0000000000000000000000000000000000000000',
        balance: formatUnits(raw, NATIVE_DECIMALS),
        rawBalance: raw.toString(),
        decimals: NATIVE_DECIMALS,
      });
    } catch {
      tokens.push({
        symbol: nativeSymbol,
        address: '0x0000000000000000000000000000000000000000',
        balance: '0',
        rawBalance: '0',
        decimals: NATIVE_DECIMALS,
      });
    }

    // ERC-20 tokens via Blockscout
    try {
      const erc20s = await fetchBlockscoutTokens(chainName, address);
      tokens.push(...erc20s);
    } catch {
      // Blockscout unavailable — return native only
    }

    return tokens;
  }

  // ─── Assemble adapter ────────────────────────────────────────────────────────

  return {
    chain: chainName,
    addressPattern: ADDRESS_PATTERN,
    setupWallet,
    getBalance,
    send,
    faucet,
    sign,
    ownedTokens,
  };
}

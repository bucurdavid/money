/**
 * fast.ts — Fast chain adapter using the real FastSet protocol.
 *
 * Uses BCS (Binary Canonical Serialization) for transaction encoding,
 * Ed25519 signing with "Transaction::" prefix, and the proxy JSON-RPC API.
 *
 * Addresses are bech32m-encoded (`set1...`) for user display, but raw
 * 32-byte public keys for RPC calls.
 */

import { bcs } from '@mysten/bcs';
import { bech32m } from 'bech32';
import { keccak_256 } from '@noble/hashes/sha3';
import type { ChainAdapter } from './adapter.js';
import {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  withKey,
  signEd25519,
  verifyEd25519,
} from '../keys.js';
import { MoneyError } from '../errors.js';
import { toHex, fromHex } from '../utils.js';
import type { FastTxExecutor, FastTransferResult } from '../providers/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FAST_DECIMALS = 18;
const DEFAULT_TOKEN = 'SET';
const ADDRESS_PATTERN = /^set1[a-z0-9]{38,}$/;
const EXPLORER_BASE = 'https://explorer.fastset.xyz/txs';
/** Native SET token ID: [0xfa, 0x57, 0x5e, 0x70, 0, 0, ..., 0] */
export const SET_TOKEN_ID = new Uint8Array(32);
SET_TOKEN_ID.set([0xfa, 0x57, 0x5e, 0x70], 0);

// ---------------------------------------------------------------------------
// BCS Type Definitions — must match on-chain types exactly
// ---------------------------------------------------------------------------

const AmountBcs = bcs.u256().transform({
  input: (val: string) => BigInt(`0x${val}`).toString(), // hex → decimal for BCS
});

const TokenTransferBcs = bcs.struct('TokenTransfer', {
  token_id: bcs.bytes(32),
  amount: AmountBcs,
  user_data: bcs.option(bcs.bytes(32)),
});

const TokenCreationBcs = bcs.struct('TokenCreation', {
  token_name: bcs.string(),
  decimals: bcs.u8(),
  initial_amount: AmountBcs,
  mints: bcs.vector(bcs.bytes(32)),
  user_data: bcs.option(bcs.bytes(32)),
});

const AddressChangeBcs = bcs.enum('AddressChange', {
  Add: bcs.tuple([]),
  Remove: bcs.tuple([]),
});

const TokenManagementBcs = bcs.struct('TokenManagement', {
  token_id: bcs.bytes(32),
  update_id: bcs.u64(),
  new_admin: bcs.option(bcs.bytes(32)),
  mints: bcs.vector(bcs.tuple([AddressChangeBcs, bcs.bytes(32)])),
  user_data: bcs.option(bcs.bytes(32)),
});

const MintBcs = bcs.struct('Mint', {
  token_id: bcs.bytes(32),
  amount: AmountBcs,
});

const ExternalClaimBodyBcs = bcs.struct('ExternalClaimBody', {
  verifier_committee: bcs.vector(bcs.bytes(32)),
  verifier_quorum: bcs.u64(),
  claim_data: bcs.vector(bcs.u8()),
});

const ExternalClaimFullBcs = bcs.struct('ExternalClaimFull', {
  claim: ExternalClaimBodyBcs,
  signatures: bcs.vector(bcs.tuple([bcs.bytes(32), bcs.bytes(64)])),
});

const ClaimTypeBcs = bcs.enum('ClaimType', {
  TokenTransfer: TokenTransferBcs,
  TokenCreation: TokenCreationBcs,
  TokenManagement: TokenManagementBcs,
  Mint: MintBcs,
  StateInitialization: bcs.struct('StateInitialization', { dummy: bcs.u8() }),
  StateUpdate: bcs.struct('StateUpdate', { dummy: bcs.u8() }),
  ExternalClaim: ExternalClaimFullBcs,
  StateReset: bcs.struct('StateReset', { dummy: bcs.u8() }),
  JoinCommittee: bcs.struct('JoinCommittee', { dummy: bcs.u8() }),
  LeaveCommittee: bcs.struct('LeaveCommittee', { dummy: bcs.u8() }),
  ChangeCommittee: bcs.struct('ChangeCommittee', { dummy: bcs.u8() }),
  Batch: bcs.vector(
    bcs.enum('Operation', {
      TokenTransfer: bcs.struct('TokenTransferOperation', {
        token_id: bcs.bytes(32),
        recipient: bcs.bytes(32),
        amount: AmountBcs,
        user_data: bcs.option(bcs.bytes(32)),
      }),
      TokenCreation: TokenCreationBcs,
      TokenManagement: TokenManagementBcs,
      Mint: bcs.struct('MintOperation', {
        token_id: bcs.bytes(32),
        recipient: bcs.bytes(32),
        amount: AmountBcs,
      }),
    }),
  ),
});

export const TransactionBcs = bcs.struct('Transaction', {
  sender: bcs.bytes(32),
  recipient: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: ClaimTypeBcs,
  archival: bcs.bool(),
});

// Hex ↔ human-readable conversion imported from ../utils.js (toHex, fromHex)

// ---------------------------------------------------------------------------
// Token ID helpers
// ---------------------------------------------------------------------------

/** Compare two token ID byte arrays for equality (length must match). */
function tokenIdEquals(a: number[] | Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Parse a hex string (with or without 0x prefix) into a 32-byte token ID.
 * The hex is interpreted as a big-endian byte string, padded with leading
 * zeros to fill 32 bytes.  e.g. "0x0102" → [0x00,…,0x01,0x02]
 * but "0x0102" + "00".repeat(30) → [0x01,0x02,0x00,…,0x00] as expected.
 */
function hexToTokenId(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  // Pad to exactly 64 hex chars (32 bytes), preserving left-side bytes
  const padded = clean.padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Address helpers: bech32m ↔ raw 32-byte pubkey
// ---------------------------------------------------------------------------

function pubkeyToAddress(publicKeyHex: string): string {
  const pubBytes = Buffer.from(publicKeyHex, 'hex');
  const words = bech32m.toWords(pubBytes);
  return bech32m.encode('set', words, 90);
}

export function addressToPubkey(address: string): Uint8Array {
  const { words } = bech32m.decode(address, 90);
  return new Uint8Array(bech32m.fromWords(words));
}

// ---------------------------------------------------------------------------
// JSON helper for Uint8Array serialization
// ---------------------------------------------------------------------------

function toJSON(data: unknown): string {
  return JSON.stringify(data, (_k, v) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return Number(v);
    return v;
  });
}

// ---------------------------------------------------------------------------
// Transaction type — inferred from TransactionBcs struct
// ---------------------------------------------------------------------------

type FastTransaction = Parameters<typeof TransactionBcs.serialize>[0];

// ---------------------------------------------------------------------------
// Transaction hashing: keccak256(BCS(transaction))
// ---------------------------------------------------------------------------

export function hashTransaction(transaction: FastTransaction): string {
  const serialized = TransactionBcs.serialize(transaction).toBytes();
  const hash = keccak_256(serialized);
  return `0x${Buffer.from(hash).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// RPC helper
// ---------------------------------------------------------------------------

export async function rpcCall(
  url: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: toJSON({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const json = (await res.json()) as {
      result?: unknown;
      error?: { message: string; code?: number };
    };
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFastAdapter(rpcUrl: string, network: string = 'testnet'): ChainAdapter {
  const adapter: ChainAdapter = {
    chain: 'fast',
    addressPattern: ADDRESS_PATTERN,

    explorerUrl(txHash: string): string {
      return `${EXPLORER_BASE}/${txHash}`;
    },

    // -----------------------------------------------------------------------
    // setupWallet: idempotent — loads existing or generates new
    // -----------------------------------------------------------------------
    async setupWallet(keyfilePath: string): Promise<{ address: string }> {
      try {
        const existing = await loadKeyfile(keyfilePath);
        const address = pubkeyToAddress(existing.publicKey);
        return { address };
      } catch {
        const keypair = await generateEd25519Key();
        await saveKeyfile(keyfilePath, keypair);
        const address = pubkeyToAddress(keypair.publicKey);
        return { address };
      }
    },

    // -----------------------------------------------------------------------
    // getBalance: proxy_getAccountInfo → parse hex balance
    // -----------------------------------------------------------------------
    async getBalance(address: string, token?: string): Promise<{ amount: string; token: string }> {
      const tok = token ?? DEFAULT_TOKEN;

      let pubkey: Uint8Array;
      try {
        pubkey = addressToPubkey(address);
      } catch {
        return { amount: '0', token: tok };
      }

      const result = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
        address: pubkey,
        token_balances_filter: null,
        state_key_filter: null,
        certificate_by_nonce: null,
      })) as {
        balance?: string;
        token_balance?: Array<[number[], string]>;
      } | null;

      if (!result) return { amount: '0', token: tok };

      // Native SET balance
      if (tok === 'SET') {
        const hexBalance = result.balance ?? '0';
        const amount = fromHex(hexBalance, FAST_DECIMALS);
        return { amount, token: tok };
      }

      // Non-native token: search token_balance array by hex token ID
      const isHex = /^(0x)?[0-9a-fA-F]+$/.test(tok);
      if (isHex) {
        const tokenIdBytes = hexToTokenId(tok);
        const entry = result.token_balance?.find(([tid]) => tokenIdEquals(tid, tokenIdBytes));
        if (!entry) return { amount: '0', token: tok };
        const [, bal] = entry;
        // bal may include a '0x' prefix
        const rawBalance = bal.startsWith('0x') || bal.startsWith('0X')
          ? bal.slice(2)
          : bal;
        const amount = fromHex(rawBalance, FAST_DECIMALS);
        return { amount, token: tok };
      }

      // Unknown token name (no alias system in Fast adapter yet)
      throw new MoneyError('TOKEN_NOT_FOUND', `Token '${tok}' not found on Fast chain`, { chain: 'fast', note: `Register the token first:\n  await money.registerToken({ chain: "fast", name: "${tok}", address: "0x...", decimals: 18 })` });
    },

    // -----------------------------------------------------------------------
    // send: BCS-encode tx, sign with "Transaction::" prefix, submit
    // -----------------------------------------------------------------------
    async send(params: {
      from: string;
      to: string;
      amount: string;
      token?: string;
      keyfile: string;
    }): Promise<{ txHash: string; explorerUrl: string; fee: string }> {
      const hexAmount = toHex(params.amount, FAST_DECIMALS);
      const senderPubkey = addressToPubkey(params.from);
      const recipientPubkey = addressToPubkey(params.to);

      try {
        return await withKey<{ txHash: string; explorerUrl: string; fee: string }>(
          params.keyfile,
          async (keypair: { publicKey: string; privateKey: string }) => {
            // Get nonce from account info
            const accountInfo = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
              address: senderPubkey,
              token_balances_filter: null,
              state_key_filter: null,
              certificate_by_nonce: null,
            })) as { next_nonce: number } | null;

            const nonce = accountInfo?.next_nonce ?? 0;

            // Build transaction
            const transaction = {
              sender: senderPubkey,
              recipient: recipientPubkey,
              nonce,
              timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
              claim: {
                TokenTransfer: {
                  token_id: SET_TOKEN_ID,
                  amount: hexAmount,
                  user_data: null,
                },
              },
              archival: false,
            };

            // Sign: ed25519("Transaction::" + BCS(transaction))
            const msgHead = new TextEncoder().encode('Transaction::');
            const msgBody = TransactionBcs.serialize(transaction).toBytes();
            const msg = new Uint8Array(msgHead.length + msgBody.length);
            msg.set(msgHead, 0);
            msg.set(msgBody, msgHead.length);

            const signature = await signEd25519(msg, keypair.privateKey);

            // Compute transaction hash: keccak256(BCS(transaction))
            const txHash = hashTransaction(transaction);

            // Submit
            await rpcCall(rpcUrl, 'proxy_submitTransaction', {
              transaction,
              signature: { Signature: signature },
            });

            return {
              txHash,
              explorerUrl: `${EXPLORER_BASE}/${txHash}`,
              fee: '0.01',
            };
          },
        );
      } catch (err: unknown) {
        if (err instanceof MoneyError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('InsufficientFunding') || msg.includes('insufficient')) {
          throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: 'fast', note: `Get testnet tokens:\n  await money.faucet({ chain: "fast" })` });
        }
        throw new MoneyError('TX_FAILED', msg, { chain: 'fast', note: `Wait 5 seconds, then retry the send.` });
      }
    },

    // -----------------------------------------------------------------------
    // sign: Ed25519 sign a message, return hex-encoded signature
    // -----------------------------------------------------------------------
    async sign(params: {
      message: string | Uint8Array;
      keyfile: string;
    }): Promise<{ signature: string; address: string }> {
      return await withKey(params.keyfile, async (kp) => {
        // Derive bech32m address from public key
        const pubkeyBytes = Buffer.from(kp.publicKey, 'hex');
        const words = bech32m.toWords(pubkeyBytes);
        const address = bech32m.encode('set', words);

        // Convert message to bytes
        const msgBytes = typeof params.message === 'string'
          ? new TextEncoder().encode(params.message)
          : params.message;

        // Sign with Ed25519
        const sigBytes = await signEd25519(msgBytes, kp.privateKey);

        // Return hex-encoded signature (Fast chain convention)
        const signature = Buffer.from(sigBytes).toString('hex');

        return { signature, address };
      });
    },

    // -----------------------------------------------------------------------
    // verifySign: verify an Ed25519 signature against a set1... address
    // -----------------------------------------------------------------------
    async verifySign(params: {
      message: string | Uint8Array;
      signature: string;
      address: string;
    }): Promise<{ valid: boolean }> {
      try {
        // Decode bech32m address to public key bytes
        const decoded = bech32m.decode(params.address, 90);
        const pubkeyBytes = bech32m.fromWords(decoded.words);
        const publicKeyHex = Buffer.from(new Uint8Array(pubkeyBytes)).toString('hex');

        // Decode hex signature to bytes
        const sigBytes = Buffer.from(params.signature, 'hex');

        // Convert message to bytes
        const msgBytes = typeof params.message === 'string'
          ? new TextEncoder().encode(params.message)
          : params.message;

        // Verify Ed25519 signature
        const valid = await verifyEd25519(sigBytes, msgBytes, publicKeyHex);
        return { valid };
      } catch {
        return { valid: false };
      }
    },

    // -----------------------------------------------------------------------
    // faucet: proxy_faucetDrip (returns null on success)
    // -----------------------------------------------------------------------
    async faucet(
      address: string,
    ): Promise<{ amount: string; token: string; txHash: string }> {
      if (network === 'mainnet') {
        throw new MoneyError('TX_FAILED',
          'Faucet is not available on mainnet.',
          { chain: 'fast', note: 'Faucet is testnet only. Fund your wallet directly on mainnet.' },
        );
      }
      const pubkey = addressToPubkey(address);
      const faucetAmount = '21e19e0c9bab2400000'; // 10,000 SET in hex

      try {
        await rpcCall(rpcUrl, 'proxy_faucetDrip', {
          recipient: pubkey,
          amount: faucetAmount,
          token_id: null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('throttl') || msg.includes('rate') || msg.includes('limit') || msg.includes('wait')) {
          const retryMatch = msg.match(/(\d+)/);
          const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : 60;
          throw new MoneyError('FAUCET_THROTTLED',
            `Faucet throttled. Try again in ~${retryAfter} seconds.`,
            { chain: 'fast', details: { retryAfter }, note: `Wait ${retryAfter} seconds, then retry:\n  await money.faucet({ chain: "fast" })` },
          );
        }
        throw new MoneyError('TX_FAILED', `Faucet failed: ${msg}`, { chain: 'fast', note: `Wait 5 seconds, then retry:\n  await money.faucet({ chain: "fast" })` });
      }

      // Check actual on-chain balance instead of trusting the drip amount
      // (faucet tx incurs fees, so received < requested)
      try {
        const bal = await adapter.getBalance(address);
        return {
          amount: bal.amount,
          token: DEFAULT_TOKEN,
          txHash: 'faucet',
        };
      } catch {
        // Fallback: report requested amount (may be slightly high due to fees)
        return {
          amount: fromHex(faucetAmount, FAST_DECIMALS),
          token: DEFAULT_TOKEN,
          txHash: 'faucet',
        };
      }
    },

    // -----------------------------------------------------------------------
    // ownedTokens: discover all tokens held by this account
    // -----------------------------------------------------------------------
    async ownedTokens(address: string): Promise<Array<{
      symbol: string;
      address: string;
      balance: string;
      rawBalance: string;
      decimals: number;
    }>> {
      let pubkey: Uint8Array;
      try {
        pubkey = addressToPubkey(address);
      } catch {
        return [];
      }

      // Fetch account with ALL token balances (empty array = all tokens)
      const result = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
        address: pubkey,
        token_balances_filter: [],
        state_key_filter: null,
        certificate_by_nonce: null,
      })) as {
        balance?: string;
        token_balance?: Array<[number[], string]>;
      } | null;

      if (!result) return [];

      const tokens: Array<{ symbol: string; address: string; balance: string; rawBalance: string; decimals: number }> = [];

      // Always include native SET
      const nativeHex = result.balance ?? '0';
      const nativeRaw = nativeHex === '0' ? '0' : BigInt(`0x${nativeHex}`).toString();
      const nativeAmount = fromHex(nativeHex, FAST_DECIMALS);
      tokens.push({
        symbol: 'SET',
        address: `0x${Buffer.from(SET_TOKEN_ID).toString('hex')}`,
        balance: nativeAmount,
        rawBalance: nativeRaw,
        decimals: FAST_DECIMALS,
      });

      // Collect custom token IDs from token_balance tuples
      const customTokenIds: Uint8Array[] = [];
      const balanceMap = new Map<string, string>();
      if (result.token_balance && result.token_balance.length > 0) {
        for (const [tid, bal] of result.token_balance) {
          const tidBytes = new Uint8Array(tid);
          const tidHex = `0x${Buffer.from(tidBytes).toString('hex')}`;
          const rawBal = bal.startsWith('0x') || bal.startsWith('0X') ? bal.slice(2) : bal;
          balanceMap.set(tidHex, rawBal);
          customTokenIds.push(tidBytes);
        }
      }

      // If there are custom tokens, fetch their metadata in one RPC call
      if (customTokenIds.length > 0) {
        try {
          const metaResult = (await rpcCall(rpcUrl, 'proxy_getTokenInfo', {
            token_ids: customTokenIds,
          })) as {
            requested_token_metadata?: Array<[number[], {
              token_name: string;
              decimals: number;
              total_supply: string;
              admin: number[];
              mints: number[][];
              update_id: number;
            } | null]>;
          } | null;

          if (metaResult?.requested_token_metadata) {
            for (const [tid, meta] of metaResult.requested_token_metadata) {
              const tidHex = `0x${Buffer.from(new Uint8Array(tid)).toString('hex')}`;
              const rawBal = balanceMap.get(tidHex) ?? '0';
              const decimals = meta?.decimals ?? FAST_DECIMALS;
              const rawDecimal = rawBal === '0' ? '0' : BigInt(`0x${rawBal}`).toString();
              tokens.push({
                symbol: meta?.token_name ?? tidHex,
                address: tidHex,
                balance: fromHex(rawBal, decimals),
                rawBalance: rawDecimal,
                decimals,
              });
            }
          }
        } catch {
          // If metadata fetch fails, still return tokens with hex addresses
          for (const [tidHex, rawBal] of balanceMap) {
            const rawDecimal = rawBal === '0' ? '0' : BigInt(`0x${rawBal}`).toString();
            tokens.push({
              symbol: tidHex,
              address: tidHex,
              balance: fromHex(rawBal, FAST_DECIMALS),
              rawBalance: rawDecimal,
              decimals: FAST_DECIMALS,
            });
          }
        }
      }

      return tokens;
    },
  };
  return adapter;
}

// ---------------------------------------------------------------------------
// FastTxExecutor factory — for bridge providers that need to submit Fast txs
// ---------------------------------------------------------------------------

export function createFastTxExecutor(
  keyfilePath: string,
  rpcUrl: string,
  senderAddress: string,
): FastTxExecutor {
  return {
    getAddress(): string {
      return senderAddress;
    },

    async sendTokenTransfer(to: string, amount: string, tokenId: Uint8Array): Promise<FastTransferResult> {
      const senderPubkey = addressToPubkey(senderAddress);
      const recipientPubkey = addressToPubkey(to);
      // amount is in raw units (decimal string like "1000000000000000000")
      // Convert to hex for BCS
      const hexAmount = BigInt(amount).toString(16);

      return await withKey<FastTransferResult>(keyfilePath, async (keypair) => {
        const accountInfo = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
          address: senderPubkey,
          token_balances_filter: null,
          state_key_filter: null,
          certificate_by_nonce: null,
        })) as { next_nonce: number } | null;

        const nonce = accountInfo?.next_nonce ?? 0;

        const transaction = {
          sender: senderPubkey,
          recipient: recipientPubkey,
          nonce,
          timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
          claim: {
            TokenTransfer: {
              token_id: tokenId,
              amount: hexAmount,
              user_data: null,
            },
          },
          archival: false,
        };

        // Sign: ed25519("Transaction::" + BCS(transaction))
        const msgHead = new TextEncoder().encode('Transaction::');
        const msgBody = TransactionBcs.serialize(transaction).toBytes();
        const msg = new Uint8Array(msgHead.length + msgBody.length);
        msg.set(msgHead, 0);
        msg.set(msgBody, msgHead.length);
        const signature = await signEd25519(msg, keypair.privateKey);

        const txHash = hashTransaction(transaction);

        const submitResult = await rpcCall(rpcUrl, 'proxy_submitTransaction', {
          transaction,
          signature: { Signature: signature },
        });

        // proxy_submitTransaction returns { Success: TransactionCertificate }
        const certificate = (submitResult as { Success?: unknown })?.Success ?? submitResult;
        if (!certificate) {
          throw new MoneyError('TX_FAILED', 'proxy_submitTransaction returned empty result', {
            chain: 'fast',
            note: 'The transaction was submitted but no certificate was returned. Try again.',
          });
        }

        return { txHash, nonce, certificate };
      });
    },

    async submitExternalClaim(recipient: string, claimData: Uint8Array): Promise<FastTransferResult> {
      const senderPubkey = addressToPubkey(senderAddress);
      const recipientPubkey = addressToPubkey(recipient);

      return await withKey<FastTransferResult>(keyfilePath, async (keypair) => {
        const accountInfo = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
          address: senderPubkey,
          token_balances_filter: null,
          state_key_filter: null,
          certificate_by_nonce: null,
        })) as { next_nonce: number } | null;

        const nonce = accountInfo?.next_nonce ?? 0;

        const transaction = {
          sender: senderPubkey,
          recipient: recipientPubkey,
          nonce,
          timestamp_nanos: BigInt(Date.now()) * 1_000_000n,
          claim: {
            ExternalClaim: {
              claim: {
                verifier_committee: [] as Uint8Array[],
                verifier_quorum: 0,
                claim_data: Array.from(claimData),
              },
              signatures: [] as Array<[Uint8Array, Uint8Array]>,
            },
          },
          archival: false,
        };

        const msgHead = new TextEncoder().encode('Transaction::');
        const msgBody = TransactionBcs.serialize(transaction).toBytes();
        const msg = new Uint8Array(msgHead.length + msgBody.length);
        msg.set(msgHead, 0);
        msg.set(msgBody, msgHead.length);
        const signature = await signEd25519(msg, keypair.privateKey);

        const txHash = hashTransaction(transaction);

        const submitResult = await rpcCall(rpcUrl, 'proxy_submitTransaction', {
          transaction,
          signature: { Signature: signature },
        });

        // proxy_submitTransaction returns { Success: TransactionCertificate }
        const certificate = (submitResult as { Success?: unknown })?.Success ?? submitResult;
        if (!certificate) {
          throw new MoneyError('TX_FAILED', 'proxy_submitTransaction returned empty result for ExternalClaim', {
            chain: 'fast',
            note: 'The ExternalClaim was submitted but no certificate was returned. Try again.',
          });
        }

        return { txHash, nonce, certificate };
      });
    },

    async evmSignCertificate(certificate: unknown): Promise<{ transaction: number[]; signature: string }> {
      const result = await rpcCall(rpcUrl, 'proxy_evmSignCertificate', {
        certificate,
      });
      const typed = result as { transaction?: number[]; signature?: string; format?: string } | null;
      if (!typed?.transaction || !typed?.signature) {
        throw new MoneyError('TX_FAILED', 'proxy_evmSignCertificate returned invalid response', {
          chain: 'fast',
          note: 'The FastSet proxy failed to cross-sign the certificate.',
        });
      }
      return { transaction: typed.transaction, signature: typed.signature };
    },
  };
}

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
import type { ChainAdapter } from './adapter.js';
import {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  withKey,
  signEd25519,
  scrubKeyFromError,
} from '../keys.js';
import { MoneyError } from '../errors.js';
import { toHex, fromHex } from '../utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAST_DECIMALS = 18;
const DEFAULT_TOKEN = 'SET';
const ADDRESS_PATTERN = /^set1[a-z0-9]{38,}$/;
/** Native SET token ID: [0xfa, 0x57, 0x5e, 0x70, 0, 0, ..., 0] */
const SET_TOKEN_ID = new Uint8Array(32);
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

const ClaimTypeBcs = bcs.enum('ClaimType', {
  TokenTransfer: TokenTransferBcs,
  TokenCreation: TokenCreationBcs,
  TokenManagement: TokenManagementBcs,
  Mint: MintBcs,
  StateInitialization: bcs.struct('StateInitialization', { dummy: bcs.u8() }),
  StateUpdate: bcs.struct('StateUpdate', { dummy: bcs.u8() }),
  ExternalClaim: bcs.struct('ExternalClaim', { data: bcs.bytes(32) }),
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

const TransactionBcs = bcs.struct('Transaction', {
  sender: bcs.bytes(32),
  recipient: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: ClaimTypeBcs,
  archival: bcs.bool(),
});

// Hex ↔ human-readable conversion imported from ../utils.js (toHex, fromHex)

// ---------------------------------------------------------------------------
// Address helpers: bech32m ↔ raw 32-byte pubkey
// ---------------------------------------------------------------------------

function pubkeyToAddress(publicKeyHex: string): string {
  const pubBytes = Buffer.from(publicKeyHex, 'hex');
  const words = bech32m.toWords(pubBytes);
  return bech32m.encode('set', words, 90);
}

function addressToPubkey(address: string): Uint8Array {
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
// RPC helper
// ---------------------------------------------------------------------------

async function rpcCall(
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
    async getBalance(
      address: string,
      token?: string,
    ): Promise<{ amount: string; token: string }> {
      const tok = token ?? DEFAULT_TOKEN;
      try {
        const pubkey = addressToPubkey(address);
        const result = (await rpcCall(rpcUrl, 'proxy_getAccountInfo', {
          address: pubkey,
          token_balances_filter: null,
          state_key_filter: null,
          certificate_by_nonce: null,
        })) as {
          balance?: string;
          token_balance?: Array<{ token_id: number[]; balance: string }>;
        } | null;

        if (!result) return { amount: '0', token: tok };

        // Native SET balance
        const hexBalance = result.balance ?? '0';
        const amount = fromHex(hexBalance, FAST_DECIMALS);
        return { amount, token: tok };
      } catch (err) {
        // Only return "0" for address-parsing errors (invalid address format).
        // Propagate RPC/network errors so callers know something is wrong.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Invalid') || msg.includes('bech32') || msg.includes('decode')) {
          return { amount: '0', token: tok };
        }
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // send: BCS-encode tx, sign with "Transaction::" prefix, submit
    // -----------------------------------------------------------------------
    async send(params: {
      from: string;
      to: string;
      amount: string;
      token?: string;
      memo?: string;
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

            // Submit
            const result = (await rpcCall(rpcUrl, 'proxy_submitTransaction', {
              transaction,
              signature: { Signature: signature },
            })) as Record<string, unknown> | null;

            // Response: { Success: { envelope: { transaction, signature }, signatures: [...] } }
            // Extract nonce as tx identifier (FastSet uses sender+nonce as unique tx ref)
            const success = result?.Success as Record<string, unknown> | undefined;
            const envelope = success?.envelope as Record<string, unknown> | undefined;
            const envelopeTx = envelope?.transaction as Record<string, unknown> | undefined;
            const txNonce = envelopeTx?.nonce ?? nonce;
            const txHash = `${Buffer.from(senderPubkey).toString('hex').slice(0, 16)}:${txNonce}`;

            return {
              txHash,
              explorerUrl: '',
              fee: '0.01',
            };
          },
        );
      } catch (err) {
        if (err instanceof MoneyError) throw err;
        const scrubbed = scrubKeyFromError(err instanceof Error ? err : new Error(String(err)));
        const msg = scrubbed instanceof Error ? scrubbed.message : String(scrubbed);
        if (msg.includes('InsufficientFunding') || msg.includes('insufficient')) {
          throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: 'fast' });
        }
        throw new MoneyError('TX_FAILED', msg, { chain: 'fast' });
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
          { chain: 'fast' },
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('throttl') || msg.includes('rate') || msg.includes('limit') || msg.includes('wait')) {
          const retryMatch = msg.match(/(\d+)/);
          const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) : 60;
          throw new MoneyError('FAUCET_THROTTLED',
            `Faucet throttled. Try again in ~${retryAfter} seconds.`,
            { chain: 'fast', details: { retryAfter } },
          );
        }
        throw new MoneyError('TX_FAILED', `Faucet failed: ${msg}`, { chain: 'fast' });
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
  };
  return adapter;
}

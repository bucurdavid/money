/**
 * solana.ts — Solana chain adapter for @fast/money SDK
 *
 * Uses @solana/web3.js (v1.x) for all on-chain interactions.
 * @solana/web3.js and @solana/spl-token are lazy-loaded so they don't
 * cost anything unless the Solana adapter is actually used.
 *
 * Keys are managed via keys.ts helpers — private keys never leave withKey().
 */

// Type-only imports (zero runtime cost)
import type {
  Connection as SolanaConnection,
  Keypair as SolanaKeypair,
} from '@solana/web3.js';

import {
  generateEd25519Key,
  saveKeyfile,
  loadKeyfile,
  withKey,
  scrubKeyFromError,
} from '../keys.js';
import { MoneyError } from '../errors.js';
import { toRaw, toHuman } from '../utils.js';
import type { ChainAdapter } from './adapter.js';
import type { HistoryEntry } from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SOL_DECIMALS = 9;
const DEFAULT_TOKEN = 'SOL';
const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EXPLORER_BASE = 'https://explorer.solana.com/tx';

// Decimal helpers imported from ../utils.js (toRaw, toHuman)

// ─── Lazy module loading ──────────────────────────────────────────────────────

let _web3: typeof import('@solana/web3.js') | null = null;
let _spl: typeof import('@solana/spl-token') | null = null;

async function getWeb3(): Promise<typeof import('@solana/web3.js')> {
  if (!_web3) _web3 = await import('@solana/web3.js');
  return _web3;
}

async function getSpl(): Promise<typeof import('@solana/spl-token')> {
  if (!_spl) _spl = await import('@solana/spl-token');
  return _spl;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSolanaAdapter(
  rpcUrl: string,
  tokens: Record<string, { mint: string; decimals: number }> = {},
  network: string = 'testnet',
): ChainAdapter {
  // ─── Lazy connection ───────────────────────────────────────────────────────

  let _connection: SolanaConnection | null = null;

  async function getConnection(): Promise<SolanaConnection> {
    if (!_connection) {
      const { Connection } = await getWeb3();
      _connection = new Connection(rpcUrl, 'confirmed');
    }
    return _connection;
  }

  // ─── Keypair reconstruction ────────────────────────────────────────────────
  // Solana's secret key = 64 bytes: [32-byte private scalar || 32-byte public key]
  // Our keyfiles store each as separate 32-byte hex strings.

  async function keypairFromHex(
    privateKeyHex: string,
    publicKeyHex: string,
  ): Promise<SolanaKeypair> {
    const { Keypair } = await getWeb3();
    const secretKey = Buffer.concat([
      Buffer.from(privateKeyHex, 'hex'),
      Buffer.from(publicKeyHex, 'hex'),
    ]);
    return Keypair.fromSecretKey(secretKey);
  }

  // ─── Explorer URL builder ──────────────────────────────────────────────────

  function explorerUrl(txHash: string): string {
    const suffix = network === 'mainnet' ? '' : '?cluster=devnet';
    return `${EXPLORER_BASE}/${txHash}${suffix}`;
  }

  // ─── setupWallet ──────────────────────────────────────────────────────────

  async function setupWallet(keyfilePath: string): Promise<{ address: string }> {
    const { PublicKey } = await getWeb3();

    // Try loading existing keyfile first — only generate if missing
    try {
      const existing = await loadKeyfile(keyfilePath);
      const pubkey = new PublicKey(Buffer.from(existing.publicKey, 'hex'));
      return { address: pubkey.toBase58() };
    } catch {
      // Keyfile doesn't exist or is unreadable — generate new wallet
      const keypair = await generateEd25519Key();
      await saveKeyfile(keyfilePath, keypair);
      const pubkey = new PublicKey(Buffer.from(keypair.publicKey, 'hex'));
      return { address: pubkey.toBase58() };
    }
  }

  // ─── getBalance ───────────────────────────────────────────────────────────

  async function getBalance(
    address: string,
    token?: string,
  ): Promise<{ amount: string; token: string }> {
    const resolvedToken = token ?? DEFAULT_TOKEN;
    const { PublicKey, LAMPORTS_PER_SOL } = await getWeb3();
    const connection = await getConnection();
    const pubkey = new PublicKey(address);

    if (resolvedToken === DEFAULT_TOKEN) {
      const lamports = await connection.getBalance(pubkey);
      return {
        amount: toHuman(lamports, SOL_DECIMALS),
        token: DEFAULT_TOKEN,
      };
    }

    // SPL token
    const tokenConfig = tokens[resolvedToken];
    if (!tokenConfig) {
      throw new Error(`Token "${resolvedToken}" is not configured for chain "solana".`);
    }

    const { getAssociatedTokenAddress, getAccount } = await getSpl();
    const mint = new PublicKey(tokenConfig.mint);

    try {
      const ata = await getAssociatedTokenAddress(mint, pubkey);
      const accountInfo = await getAccount(connection, ata);
      return {
        amount: toHuman(accountInfo.amount, tokenConfig.decimals),
        token: resolvedToken,
      };
    } catch {
      // Account doesn't exist yet → zero balance
      return { amount: '0', token: resolvedToken };
    }
  }

  // ─── send ─────────────────────────────────────────────────────────────────

  async function send(params: {
    from: string;
    to: string;
    amount: string;
    token?: string;
    memo?: string;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }> {
    const resolvedToken = params.token ?? DEFAULT_TOKEN;
    const isNative = resolvedToken === DEFAULT_TOKEN;

    try {
      return await withKey(params.keyfile, async (kp) => {
        const {
          PublicKey,
          SystemProgram,
          Transaction,
          sendAndConfirmTransaction,
          LAMPORTS_PER_SOL,
        } = await getWeb3();
        const connection = await getConnection();
        const signer = await keypairFromHex(kp.privateKey, kp.publicKey);
        const toPubkey = new PublicKey(params.to);

        let txHash: string;

        if (isNative) {
          const lamports = toRaw(params.amount, SOL_DECIMALS);
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: signer.publicKey,
              toPubkey,
              lamports,
            }),
          );
          txHash = await sendAndConfirmTransaction(connection, tx, [signer]);
        } else {
          // SPL token transfer
          const tokenConfig = tokens[resolvedToken];
          if (!tokenConfig) {
            throw new Error(`Token "${resolvedToken}" is not configured for chain "solana".`);
          }
          const { getOrCreateAssociatedTokenAccount, transfer: splTransfer } = await getSpl();
          const mint = new PublicKey(tokenConfig.mint);
          const rawAmount = toRaw(params.amount, tokenConfig.decimals);

          const sourceAta = await getOrCreateAssociatedTokenAccount(
            connection,
            signer,
            mint,
            signer.publicKey,
          );
          const destAta = await getOrCreateAssociatedTokenAccount(
            connection,
            signer,
            mint,
            toPubkey,
          );

          txHash = await splTransfer(
            connection,
            signer,
            sourceAta.address,
            destAta.address,
            signer,
            rawAmount,
          );
        }

        // Try to fetch fee from confirmed transaction
        let fee = '0';
        try {
          const txDetail = await connection.getTransaction(txHash, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          if (txDetail?.meta?.fee != null) {
            fee = toHuman(txDetail.meta.fee, SOL_DECIMALS);
          }
        } catch {
          // Non-critical — fee stays '0'
        }

        return {
          txHash,
          explorerUrl: explorerUrl(txHash),
          fee,
        };
      });
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      const scrubbed = scrubKeyFromError(err instanceof Error ? err : new Error(String(err)));
      const msg = scrubbed instanceof Error ? scrubbed.message : String(scrubbed);
      if (msg.includes('debit an account') || msg.includes('insufficient') || msg.includes('0x1')) {
        throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: 'solana' });
      }
      throw new MoneyError('TX_FAILED', msg, { chain: 'solana' });
    }
  }

  // ─── faucet ───────────────────────────────────────────────────────────────

  async function faucet(address: string): Promise<{ amount: string; token: string; txHash: string }> {
    if (network === 'mainnet') {
      throw new MoneyError('TX_FAILED',
        'Faucet is not available on mainnet.',
        { chain: 'solana' },
      );
    }
    const { PublicKey, LAMPORTS_PER_SOL } = await getWeb3();
    const connection = await getConnection();
    const pubkey = new PublicKey(address);

    const sig = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);

    // Confirm the airdrop
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: sig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    return { amount: '1', token: DEFAULT_TOKEN, txHash: sig };
  }

  // ─── getHistory ───────────────────────────────────────────────────────────

  async function getHistory(address: string, limit = 20): Promise<HistoryEntry[]> {
    const { PublicKey } = await getWeb3();
    const connection = await getConnection();
    const pubkey = new PublicKey(address);

    const signatures = await connection.getSignaturesForAddress(pubkey, { limit });

    const entries: HistoryEntry[] = [];

    for (const sigInfo of signatures) {
      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta) continue;

        const accountKeys = tx.transaction.message.staticAccountKeys ?? [];
        const addrIndex = accountKeys.findIndex((k) => k.toBase58() === address);
        if (addrIndex < 0) continue;

        const preBal = tx.meta.preBalances[addrIndex] ?? 0;
        const postBal = tx.meta.postBalances[addrIndex] ?? 0;
        const delta = postBal - preBal;

        if (delta === 0) continue;

        const direction: 'sent' | 'received' = delta < 0 ? 'sent' : 'received';
        const absDelta = Math.abs(delta);

        // Find counterparty: the other primary account in the transfer
        const counterpartyIndex = delta < 0 ? 1 : 0;
        const counterparty = accountKeys[counterpartyIndex]?.toBase58() ?? '';

        entries.push({
          txHash: sigInfo.signature,
          direction,
          amount: toHuman(absDelta, SOL_DECIMALS),
          token: DEFAULT_TOKEN,
          counterparty,
          timestamp: sigInfo.blockTime
            ? new Date(sigInfo.blockTime * 1000).toISOString()
            : new Date(0).toISOString(),
        });
      } catch {
        // Skip unparseable transactions
      }
    }

    return entries;
  }

  // ─── Assemble adapter ─────────────────────────────────────────────────────

  return {
    chain: 'solana',
    addressPattern: ADDRESS_PATTERN,
    setupWallet,
    getBalance,
    send,
    faucet,
    getHistory,
  };
}

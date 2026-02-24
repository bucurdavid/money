/**
 * solana.ts — Solana chain adapter for money SDK
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
  aliases: Record<string, { mint: string; decimals: number }> = {},
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

  const decimalsCache = new Map<string, number>();

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
    // SDK maps all non-mainnet Solana to devnet explorer cluster.
    // parseConfigKey returns 'testnet' for bare keys, but the actual RPC
    // is devnet — so any non-mainnet value correctly resolves to devnet.
    const suffix = network === 'mainnet' ? '' : '?cluster=devnet';
    return `${EXPLORER_BASE}/${txHash}${suffix}`;
  }

  // ─── resolveSplToken ──────────────────────────────────────────────────────

  type ResolvedSplToken =
    | { type: 'native' }
    | { type: 'spl'; mint: string; decimals: number };

  async function resolveSplToken(token?: string): Promise<ResolvedSplToken> {
    const t = token ?? DEFAULT_TOKEN;
    if (t === DEFAULT_TOKEN) return { type: 'native' };

    // Named alias — checked first (O(1), free, always wins over raw address)
    const aliasConfig = aliases[t];
    if (aliasConfig) {
      return { type: 'spl', mint: aliasConfig.mint, decimals: aliasConfig.decimals };
    }

    // Raw SPL mint address (base58, 32-44 chars) — fetches decimals on-chain
    if (ADDRESS_PATTERN.test(t)) {
      let decimals = decimalsCache.get(t);
      if (decimals === undefined) {
        const { PublicKey } = await getWeb3();
        const { getMint } = await getSpl();
        const connection = await getConnection();
        const mintInfo = await getMint(connection, new PublicKey(t));
        decimals = mintInfo.decimals;
        decimalsCache.set(t, decimals);
      }
      return { type: 'spl', mint: t, decimals };
    }

    throw new MoneyError('TOKEN_NOT_FOUND', `Token "${t}" is not configured for chain "solana".`, { chain: 'solana' });
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
    const resolved = await resolveSplToken(token);
    const { PublicKey } = await getWeb3();
    const connection = await getConnection();
    const pubkey = new PublicKey(address);

    if (resolved.type === 'native') {
      const lamports = await connection.getBalance(pubkey);
      return { amount: toHuman(lamports, SOL_DECIMALS), token: DEFAULT_TOKEN };
    }

    const { getAssociatedTokenAddress, getAccount } = await getSpl();
    const mint = new PublicKey(resolved.mint);

    try {
      const ata = await getAssociatedTokenAddress(mint, pubkey);
      const accountInfo = await getAccount(connection, ata);
      const label = token ?? resolved.mint;
      return { amount: toHuman(accountInfo.amount, resolved.decimals), token: label };
    } catch {
      return { amount: '0', token: token ?? resolved.mint };
    }
  }

  // ─── send ─────────────────────────────────────────────────────────────────

  async function send(params: {
    from: string;
    to: string;
    amount: string;
    token?: string;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }> {
    // Resolve token BEFORE entering withKey so errors propagate cleanly
    const resolved = await resolveSplToken(params.token);

    try {
      return await withKey(params.keyfile, async (kp) => {
        const {
          PublicKey,
          SystemProgram,
          Transaction,
          sendAndConfirmTransaction,
        } = await getWeb3();
        const connection = await getConnection();
        const signer = await keypairFromHex(kp.privateKey, kp.publicKey);
        const toPubkey = new PublicKey(params.to);

        let txHash: string;

        if (resolved.type === 'native') {
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
          const { getOrCreateAssociatedTokenAccount, transfer: splTransfer } = await getSpl();
          const mint = new PublicKey(resolved.mint);
          const rawAmount = toRaw(params.amount, resolved.decimals);

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

        return { txHash, explorerUrl: explorerUrl(txHash), fee };
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

  // ─── Assemble adapter ─────────────────────────────────────────────────────

  return {
    chain: 'solana',
    addressPattern: ADDRESS_PATTERN,
    setupWallet,
    getBalance,
    send,
    faucet,
  };
}

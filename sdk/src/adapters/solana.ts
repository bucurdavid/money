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

let _anchor: typeof import('@coral-xyz/anchor') | null = null;

async function getAnchor(): Promise<typeof import('@coral-xyz/anchor')> {
  if (!_anchor) _anchor = await import('@coral-xyz/anchor');
  return _anchor;
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

  // ─── Well-known Solana accounts (auto-resolved) ────────────────────────────

  const WELL_KNOWN_ACCOUNTS: Record<string, string> = {
    systemProgram: '11111111111111111111111111111111',
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    rent: 'SysvarRent111111111111111111111111111111111',
    clock: 'SysvarC1ock11111111111111111111111111111111',
    token2022Program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  };

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

    throw new MoneyError('TOKEN_NOT_FOUND', `Token "${t}" is not configured for chain "solana".`, { chain: 'solana', note: `Register the token first:\n  await money.registerToken({ chain: "solana", name: "${t}", mint: "...", decimals: 9 })` });
  }

  // ─── Instruction builder from IDL ─────────────────────────────────────────

  async function buildInstruction(params: {
    address: string;
    idl: unknown;
    functionName: string;
    args?: unknown[];
    accounts?: Record<string, string>;
    signerPubkey?: string;
  }): Promise<{
    instruction: import('@solana/web3.js').TransactionInstruction;
    programId: import('@solana/web3.js').PublicKey;
  }> {
    const { BorshCoder } = await getAnchor();
    const { PublicKey, TransactionInstruction } = await getWeb3();

    const idl = params.idl as {
      name: string;
      instructions: Array<{
        name: string;
        accounts: Array<{ name: string; isMut: boolean; isSigner: boolean }>;
        args: Array<{ name: string; type: unknown }>;
      }>;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coder = new BorshCoder(idl as any);

    // Find the instruction definition in the IDL
    const ixDef = idl.instructions.find((ix) => ix.name === params.functionName);
    if (!ixDef) {
      throw new MoneyError('INVALID_PARAMS', `Instruction "${params.functionName}" not found in IDL for program "${idl.name}".`, {
        chain: 'solana',
        note: `Available instructions: ${idl.instructions.map((ix) => ix.name).join(', ')}`,
      });
    }

    // Encode instruction data using BorshCoder
    const data = coder.instruction.encode(params.functionName, params.args ?? {});

    // Build account keys
    const programId = new PublicKey(params.address);
    const userAccounts = params.accounts ?? {};

    const keys = ixDef.accounts.map((acc) => {
      // Check user-provided accounts first
      const userAddr = userAccounts[acc.name];
      if (userAddr) {
        return {
          pubkey: new PublicKey(userAddr),
          isSigner: acc.isSigner,
          isWritable: acc.isMut,
        };
      }

      // Auto-resolve well-known accounts
      const wellKnown = WELL_KNOWN_ACCOUNTS[acc.name];
      if (wellKnown) {
        return {
          pubkey: new PublicKey(wellKnown),
          isSigner: false,
          isWritable: acc.isMut,
        };
      }

      // If the account is the signer and we have the signer pubkey, use it
      if (acc.isSigner && params.signerPubkey) {
        return {
          pubkey: new PublicKey(params.signerPubkey),
          isSigner: true,
          isWritable: acc.isMut,
        };
      }

      throw new MoneyError('INVALID_PARAMS', `Missing account "${acc.name}" for instruction "${params.functionName}".`, {
        chain: 'solana',
        note: `Provide the account in the "accounts" parameter:\n  accounts: { ${acc.name}: "address..." }`,
      });
    });

    const instruction = new TransactionInstruction({
      keys,
      programId,
      data,
    });

    return { instruction, programId };
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
    } catch (err: unknown) {
      if (err instanceof MoneyError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('debit an account') || msg.includes('insufficient') || msg.includes('0x1')) {
        throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: 'solana', note: `Get testnet tokens:\n  await money.faucet({ chain: "solana" })` });
      }
      throw new MoneyError('TX_FAILED', msg, { chain: 'solana', note: `Wait 5 seconds, then retry the send.` });
    }
  }

  // ─── readContract ─────────────────────────────────────────────────────────

  async function readContract(params: {
    address: string;
    abi?: unknown[];
    idl?: unknown;
    accounts?: Record<string, string>;
    functionName: string;
    args?: unknown[];
  }): Promise<unknown> {
    if (!params.idl) {
      throw new MoneyError('INVALID_PARAMS', 'Solana readContract requires "idl" parameter.', {
        chain: 'solana',
        note: 'Provide an Anchor IDL:\n  await money.readContract({ chain: "solana", address: "...", idl: {...}, functionName: "..." })\nOr fetch it:\n  const { idl } = await money.fetchContractInterface({ chain: "solana", address: "..." })',
      });
    }

    const { Transaction } = await getWeb3();
    const connection = await getConnection();

    const { instruction } = await buildInstruction({
      address: params.address,
      idl: params.idl,
      functionName: params.functionName,
      args: params.args,
      accounts: params.accounts,
    });

    const tx = new Transaction().add(instruction);
    tx.feePayer = instruction.keys.find((k) => k.isSigner)?.pubkey ?? instruction.programId;

    const latestBlockhash = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBlockhash.blockhash;

    const simulation = await connection.simulateTransaction(tx);

    if (simulation.value.err) {
      throw new MoneyError('TX_FAILED', `Simulation failed: ${JSON.stringify(simulation.value.err)}`, {
        chain: 'solana',
        note: 'Check that all accounts are correct and the instruction args match the IDL.',
      });
    }

    return {
      logs: simulation.value.logs ?? [],
      returnData: simulation.value.returnData ?? null,
      unitsConsumed: simulation.value.unitsConsumed ?? 0,
    };
  }

  // ─── writeContract ────────────────────────────────────────────────────────

  async function writeContract(params: {
    address: string;
    abi?: unknown[];
    idl?: unknown;
    accounts?: Record<string, string>;
    functionName: string;
    args?: unknown[];
    value?: bigint;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }> {
    if (!params.idl) {
      throw new MoneyError('INVALID_PARAMS', 'Solana writeContract requires "idl" parameter.', {
        chain: 'solana',
        note: 'Provide an Anchor IDL:\n  await money.writeContract({ chain: "solana", address: "...", idl: {...}, functionName: "...", accounts: {...} })',
      });
    }

    try {
      return await withKey(params.keyfile, async (kp) => {
        const {
          PublicKey,
          Transaction,
          SystemProgram,
          sendAndConfirmTransaction,
        } = await getWeb3();
        const connection = await getConnection();
        const signer = await keypairFromHex(kp.privateKey, kp.publicKey);

        const { instruction } = await buildInstruction({
          address: params.address,
          idl: params.idl!,
          functionName: params.functionName,
          args: params.args,
          accounts: params.accounts,
          signerPubkey: signer.publicKey.toBase58(),
        });

        const tx = new Transaction();

        // If value is provided, add a SOL transfer instruction first
        if (params.value && params.value > 0n) {
          const toPubkey = new PublicKey(params.address);
          tx.add(
            SystemProgram.transfer({
              fromPubkey: signer.publicKey,
              toPubkey,
              lamports: params.value,
            }),
          );
        }

        tx.add(instruction);

        const txHash = await sendAndConfirmTransaction(connection, tx, [signer]);

        // Fetch fee from transaction
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
    } catch (err: unknown) {
      if (err instanceof MoneyError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('debit an account') || msg.includes('insufficient') || msg.includes('0x1')) {
        throw new MoneyError('INSUFFICIENT_BALANCE', msg, { chain: 'solana', note: `Get testnet tokens:\n  await money.faucet({ chain: "solana" })` });
      }
      throw new MoneyError('TX_FAILED', msg, { chain: 'solana', note: `Wait 5 seconds, then retry the call.` });
    }
  }

  // ─── fetchContractInterface ───────────────────────────────────────────────

  async function fetchContractInterface(address: string): Promise<{
    name: string | null;
    abi: unknown[] | null;
    idl: unknown | null;
  }> {
    try {
      const { Program } = await getAnchor();
      const { PublicKey } = await getWeb3();
      const connection = await getConnection();

      // Anchor's fetchIdl needs a minimal provider-like object
      const programId = new PublicKey(address);

      // Fetch the IDL account directly — Anchor stores IDLs at a deterministic PDA
      const idl = await Program.fetchIdl(programId.toBase58(), {
        connection,
      } as Parameters<typeof Program.fetchIdl>[1]);

      if (!idl) {
        return { name: null, abi: null, idl: null };
      }

      const idlObj = idl as { name?: string };
      return {
        name: idlObj.name ?? null,
        abi: null,
        idl,
      };
    } catch {
      return { name: null, abi: null, idl: null };
    }
  }

  // ─── faucet ───────────────────────────────────────────────────────────────

  async function faucet(address: string): Promise<{ amount: string; token: string; txHash: string }> {
    if (network === 'mainnet') {
      throw new MoneyError('TX_FAILED',
        'Faucet is not available on mainnet.',
        { chain: 'solana', note: 'Faucet is testnet only. Fund your wallet directly on mainnet.' },
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
    readContract,
    writeContract,
    fetchContractInterface,
  };
}

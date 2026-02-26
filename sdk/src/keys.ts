/**
 * keys.ts — Key management for money SDK
 *
 * SECURITY INVARIANT: Private keys MUST NEVER appear in any return value,
 * log, error message, or console output (except the internal generate/load
 * functions that return them for immediate use by withKey).
 */

import { randomBytes } from 'node:crypto';
import { open, readFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { constants } from 'node:fs';
import { expandHome } from './utils.js';
import * as ed from '@noble/ed25519';
import * as secp from '@noble/secp256k1';
import { sha512 } from '@noble/hashes/sha512';

// Required for @noble/ed25519 synchronous hashing in Node.js
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(
  msgs.length === 1 ? msgs[0] : new Uint8Array(msgs.reduce((a, m) => { const r = new Uint8Array(a.length + m.length); r.set(a); r.set(m, a.length); return r; }, new Uint8Array(0)))
);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate an ed25519 keypair.
 * Internal — callers should prefer withKey().
 */
export async function generateEd25519Key(): Promise<{ publicKey: string; privateKey: string }> {
  const privKeyBuf = randomBytes(32);
  const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBuf);
  const result = {
    publicKey: Buffer.from(pubKeyBytes).toString('hex'),
    privateKey: privKeyBuf.toString('hex'),
  };
  // Zero out the buffer immediately after extraction
  privKeyBuf.fill(0);
  return result;
}

/**
 * Generate a secp256k1 keypair.
 * Internal — callers should prefer withKey().
 */
export async function generateSecp256k1Key(): Promise<{ publicKey: string; privateKey: string }> {
  const privKeyBuf = randomBytes(32);
  try {
    const pubKeyBytes = secp.getPublicKey(privKeyBuf, false); // false = uncompressed (65 bytes)
    return {
      publicKey: Buffer.from(pubKeyBytes).toString('hex'),
      privateKey: privKeyBuf.toString('hex'),
    };
  } finally {
    privKeyBuf.fill(0);
  }
}

/**
 * Load a keyfile from disk.
 * Expands `~` in the path.
 */
export async function loadKeyfile(
  path: string,
): Promise<{ publicKey: string; privateKey: string }> {
  const resolved = expandHome(path);
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read keyfile at ${resolved}: ${msg}`);
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.publicKey !== 'string' || typeof parsed.privateKey !== 'string') {
    throw new Error(`Keyfile at ${resolved} is missing publicKey or privateKey fields`);
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

/**
 * Save a keypair to a keyfile.
 * Creates parent directories with mode 0700 and writes the file with mode 0600.
 *
 * Uses O_CREAT | O_WRONLY | O_EXCL so the call **fails** if the file already
 * exists.  This prevents any code path from accidentally overwriting a wallet
 * private key.
 *
 * After writing, a backup copy is created at `<dir>/backups/<name>` so keys
 * can be recovered even if the primary file is accidentally deleted.
 */
export async function saveKeyfile(
  keyPath: string,
  keypair: { publicKey: string; privateKey: string },
): Promise<void> {
  const resolved = expandHome(keyPath);
  const dir = dirname(resolved);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const json = JSON.stringify({ publicKey: keypair.publicKey, privateKey: keypair.privateKey }, null, 2);

  // O_EXCL: fail if file exists — never overwrite a keyfile
  const fd = await open(resolved, constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL, 0o600);
  try {
    await fd.writeFile(json, { encoding: 'utf-8' });
  } finally {
    await fd.close();
  }

  // Write a backup copy (best-effort — don't fail key creation if backup fails)
  try {
    const backupDir = join(dir, 'backups');
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = join(backupDir, basename(resolved));
    await copyFile(resolved, backupPath, constants.COPYFILE_EXCL);
    await chmod(backupPath, 0o400);
  } catch {
    // Backup is best-effort; primary keyfile was already written successfully
  }
}

/**
 * Sign a message with ed25519.
 */
export async function signEd25519(message: Uint8Array, privateKeyHex: string): Promise<Uint8Array> {
  const privKeyBuf = Buffer.from(privateKeyHex, 'hex');
  try {
    return await ed.signAsync(message, privKeyBuf);
  } finally {
    privKeyBuf.fill(0);
  }
}

/**
 * Verify an Ed25519 signature.
 * Returns true if the signature is valid for the given message and public key.
 */
export async function verifyEd25519(
  signature: Uint8Array,
  message: Uint8Array,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');
    return await ed.verifyAsync(signature, message, pubKeyBytes);
  } catch {
    return false;
  }
}

/**
 * Sign a message hash with secp256k1 (ECDSA).
 * Returns r, s as 64-char hex strings and v as the recovery bit (0 or 1).
 */
export async function signSecp256k1(
  messageHash: Uint8Array,
  privateKeyHex: string,
): Promise<{ r: string; s: string; v: number }> {
  const privKeyBuf = Buffer.from(privateKeyHex, 'hex');
  try {
    // format: 'recovered' returns 65 bytes: recovery(1) || r(32) || s(32)
    const sigBytes = await secp.signAsync(messageHash, privKeyBuf, {
      prehash: false,
      format: 'recovered',
    });
    const rHex = Buffer.from(sigBytes.slice(1, 33)).toString('hex');
    const sHex = Buffer.from(sigBytes.slice(33, 65)).toString('hex');
    return { r: rHex, s: sHex, v: sigBytes[0] };
  } finally {
    privKeyBuf.fill(0);
  }
}

/**
 * Load a keypair, run `fn` with it, then zero out the private key from memory.
 * This is the primary way adapters should access keys.
 */
export async function withKey<T>(
  keyfilePath: string,
  fn: (keypair: { publicKey: string; privateKey: string }) => Promise<T>,
): Promise<T> {
  const keypair = await loadKeyfile(keyfilePath);
  const privBuf = Buffer.from(keypair.privateKey, 'hex');
  try {
    return await fn(keypair);
  } finally {
    // Overwrite the private key string's backing store as best we can in JS
    privBuf.fill(0);
    // Replace with zeroed string to drop the reference
    (keypair as { publicKey: string; privateKey: string }).privateKey =
      '0'.repeat(keypair.privateKey.length);
  }
}

// expandHome imported from ./utils.js

/**
 * keys.ts — Key management for money SDK
 *
 * SECURITY INVARIANT: Private keys MUST NEVER appear in any return value,
 * log, error message, or console output (except the internal generate/load
 * functions that return them for immediate use by withKey).
 */

import {
  randomBytes,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
} from 'node:crypto';
import { open, readFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { constants } from 'node:fs';
import { expandHome } from './utils.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Required for @noble/ed25519 synchronous hashing in Node.js
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(
  msgs.length === 1 ? msgs[0] : new Uint8Array(msgs.reduce((a, m) => { const r = new Uint8Array(a.length + m.length); r.set(a); r.set(m, a.length); return r; }, new Uint8Array(0)))
);

// ─── secp256k1 DER helpers ────────────────────────────────────────────────────
//
// SEC1 DER layout for a secp256k1 private key:
//   SEQUENCE {
//     INTEGER 1                          -- version
//     OCTET STRING (32 bytes)            -- private key
//     [0] EXPLICIT OID secp256k1         -- curve
//   }
//
// Byte layout:
//   30 2e                               -- SEQUENCE, 46 bytes
//     02 01 01                          -- INTEGER 1
//     04 20 [32 bytes]                  -- OCTET STRING
//     a0 07 06 05 2b 81 04 00 0a        -- [0] OID 1.3.132.0.10
//
// Total prefix (before private key): 7 bytes
// Total suffix (after private key):  9 bytes
//
const SEC1_SECP256K1_PREFIX = Buffer.from([
  0x30, 0x2e,               // SEQUENCE(46)
  0x02, 0x01, 0x01,         // version = 1
  0x04, 0x20,               // OCTET STRING(32)
]);
const SEC1_SECP256K1_SUFFIX = Buffer.from([
  0xa0, 0x07,               // [0] EXPLICIT(7)
  0x06, 0x05,               // OID(5)
  0x2b, 0x81, 0x04, 0x00, 0x0a, // secp256k1 (1.3.132.0.10)
]);

//
// SPKI DER layout for a secp256k1 uncompressed public key (65 bytes):
//   SEQUENCE {
//     SEQUENCE {
//       OID ecPublicKey  (1.2.840.10045.2.1)
//       OID secp256k1    (1.3.132.0.10)
//     }
//     BIT STRING {0x00, 0x04, x(32), y(32)}
//   }
//
// The uncompressed point (04 || x || y) starts at byte offset 23.
//
const SPKI_SECP256K1_POINT_OFFSET = 23;

function buildSec1Der(privKeyBuf: Buffer): Buffer {
  return Buffer.concat([SEC1_SECP256K1_PREFIX, privKeyBuf, SEC1_SECP256K1_SUFFIX]);
}

function extractSpkiPublicKey(spkiDer: Buffer): Buffer {
  // Returns the 65-byte uncompressed point (04 || x || y)
  return spkiDer.slice(SPKI_SECP256K1_POINT_OFFSET);
}

/** Parse a DER-encoded ECDSA signature into r and s as hex strings. */
function parseDerSignature(der: Buffer): { r: string; s: string } {
  // 30 [total-len] 02 [r-len] [r-bytes] 02 [s-len] [s-bytes]
  let offset = 2; // skip 0x30 and total length
  if (der[offset] !== 0x02) throw new Error('Bad DER sig: expected INTEGER tag for r');
  offset++;
  const rLen = der[offset++];
  const rBytes = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset] !== 0x02) throw new Error('Bad DER sig: expected INTEGER tag for s');
  offset++;
  const sLen = der[offset++];
  const sBytes = der.slice(offset, offset + sLen);

  // DER integers are big-endian and may have a leading 0x00 padding byte
  const rHex = rBytes.toString('hex').replace(/^00/, '').padStart(64, '0');
  const sHex = sBytes.toString('hex').replace(/^00/, '').padStart(64, '0');
  return { r: rHex, s: sHex };
}

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
 * Generate a secp256k1 keypair using Node.js crypto.
 * Internal — callers should prefer withKey().
 */
export async function generateSecp256k1Key(): Promise<{ publicKey: string; privateKey: string }> {
  const privKeyBuf = randomBytes(32);
  try {
    const sec1Der = buildSec1Der(privKeyBuf);
    const privKeyObj = createPrivateKey({ key: sec1Der, format: 'der', type: 'sec1' });
    const pubKeyObj = createPublicKey(privKeyObj);
    const spkiDer = pubKeyObj.export({ format: 'der', type: 'spki' }) as Buffer;
    const pubKeyHex = extractSpkiPublicKey(spkiDer).toString('hex');
    return {
      publicKey: pubKeyHex,
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
    // Lock down backup permissions
    const { chmod } = await import('node:fs/promises');
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
 * Returns r, s as 64-char hex strings and v as a recovery hint (0).
 *
 * Note: Node.js crypto does not expose the ECDSA recovery bit. v is always 0
 * here — adapters that need EIP-155 recovery must compute it themselves.
 */
export async function signSecp256k1(
  messageHash: Uint8Array,
  privateKeyHex: string,
): Promise<{ r: string; s: string; v: number }> {
  const privKeyBuf = Buffer.from(privateKeyHex, 'hex');
  try {
    const sec1Der = buildSec1Der(privKeyBuf);
    const privKeyObj = createPrivateKey({ key: sec1Der, format: 'der', type: 'sec1' });
    // null algorithm = sign raw bytes (messageHash already hashed by caller)
    const derSig = cryptoSign(null, Buffer.from(messageHash), privKeyObj) as Buffer;
    const { r, s } = parseDerSignature(derSig);
    return { r, s, v: 0 };
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

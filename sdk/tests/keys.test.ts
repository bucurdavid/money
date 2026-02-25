import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  generateEd25519Key,
  generateSecp256k1Key,
  saveKeyfile,
  loadKeyfile,
  signEd25519,
  signSecp256k1,
  withKey,
} from '../src/keys.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let tmpHomeSubDir: string; // A temp dir inside homedir for ~ expansion tests

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-keys-test-'));
  // Create a temp dir inside homedir so we can use ~/... paths
  tmpHomeSubDir = await fs.mkdtemp(path.join(os.homedir(), '.money-keys-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(tmpHomeSubDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateEd25519Key
// ---------------------------------------------------------------------------

describe('generateEd25519Key', () => {
  it('returns a 64-char hex privateKey and 64-char hex publicKey', async () => {
    const kp = await generateEd25519Key();
    assert.equal(typeof kp.privateKey, 'string');
    assert.equal(typeof kp.publicKey, 'string');
    assert.equal(kp.privateKey.length, 64, 'privateKey should be 64 hex chars (32 bytes)');
    assert.equal(kp.publicKey.length, 64, 'publicKey should be 64 hex chars (32 bytes)');
    assert.match(kp.privateKey, /^[0-9a-f]{64}$/, 'privateKey should be lowercase hex');
    assert.match(kp.publicKey, /^[0-9a-f]{64}$/, 'publicKey should be lowercase hex');
  });

  it('returns different keys on each call (not deterministic)', async () => {
    const kp1 = await generateEd25519Key();
    const kp2 = await generateEd25519Key();
    assert.notEqual(kp1.privateKey, kp2.privateKey, 'privateKeys should differ');
    assert.notEqual(kp1.publicKey, kp2.publicKey, 'publicKeys should differ');
  });
});

// ---------------------------------------------------------------------------
// generateSecp256k1Key
// ---------------------------------------------------------------------------

describe('generateSecp256k1Key', () => {
  it('returns a 64-char hex privateKey and 130-char hex publicKey (uncompressed, starts with 04)', async () => {
    const kp = await generateSecp256k1Key();
    assert.equal(typeof kp.privateKey, 'string');
    assert.equal(typeof kp.publicKey, 'string');
    assert.equal(kp.privateKey.length, 64, 'privateKey should be 64 hex chars (32 bytes)');
    assert.equal(kp.publicKey.length, 130, 'publicKey should be 130 hex chars (65 bytes uncompressed)');
    assert.match(kp.privateKey, /^[0-9a-f]{64}$/, 'privateKey should be lowercase hex');
    assert.ok(kp.publicKey.startsWith('04'), 'publicKey should start with 04 (uncompressed point)');
  });

  it('returns different keys on each call (not deterministic)', async () => {
    const kp1 = await generateSecp256k1Key();
    const kp2 = await generateSecp256k1Key();
    assert.notEqual(kp1.privateKey, kp2.privateKey, 'privateKeys should differ');
    assert.notEqual(kp1.publicKey, kp2.publicKey, 'publicKeys should differ');
  });
});

// ---------------------------------------------------------------------------
// saveKeyfile
// ---------------------------------------------------------------------------

describe('saveKeyfile', () => {
  it('creates parent directories when they do not exist', async () => {
    const keyfile = path.join(tmpDir, 'nested', 'deep', 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const stat = await fs.stat(keyfile);
    assert.ok(stat.isFile(), 'keyfile should be a regular file');
  });

  it('writes JSON with publicKey and privateKey fields', async () => {
    const keyfile = path.join(tmpDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const raw = await fs.readFile(keyfile, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.publicKey, kp.publicKey, 'publicKey should match');
    assert.equal(parsed.privateKey, kp.privateKey, 'privateKey should match');
  });

  it('writes the file with mode 0600', async () => {
    const keyfile = path.join(tmpDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const stat = await fs.stat(keyfile);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `expected file mode 0600, got 0${mode.toString(8)}`);
  });

  it('creates the parent directory with mode 0700', async () => {
    const parentDir = path.join(tmpDir, 'newkeys');
    const keyfile = path.join(parentDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const stat = await fs.stat(parentDir);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o700, `expected dir mode 0700, got 0${mode.toString(8)}`);
  });
});

// ---------------------------------------------------------------------------
// loadKeyfile
// ---------------------------------------------------------------------------

describe('loadKeyfile', () => {
  it('loads a saved keyfile correctly (round-trip with saveKeyfile)', async () => {
    const keyfile = path.join(tmpDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const loaded = await loadKeyfile(keyfile);
    assert.equal(loaded.publicKey, kp.publicKey, 'publicKey should round-trip');
    assert.equal(loaded.privateKey, kp.privateKey, 'privateKey should round-trip');
  });

  it('throws with a descriptive message on missing file', async () => {
    const missing = path.join(tmpDir, 'does-not-exist.json');
    await assert.rejects(
      () => loadKeyfile(missing),
      (err: Error) => {
        assert.ok(err instanceof Error, 'should be an Error');
        assert.ok(
          err.message.includes('Failed to read keyfile'),
          `expected descriptive message, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws on malformed JSON', async () => {
    const keyfile = path.join(tmpDir, 'bad.json');
    await fs.writeFile(keyfile, '{ not valid json }', 'utf-8');
    await assert.rejects(
      () => loadKeyfile(keyfile),
      (err: Error) => {
        assert.ok(err instanceof Error, 'should be an Error');
        return true;
      },
    );
  });

  it('throws on missing publicKey/privateKey fields', async () => {
    const keyfile = path.join(tmpDir, 'incomplete.json');
    await fs.writeFile(keyfile, JSON.stringify({ publicKey: 'only-pub' }), 'utf-8');
    await assert.rejects(
      () => loadKeyfile(keyfile),
      (err: Error) => {
        assert.ok(err instanceof Error, 'should be an Error');
        assert.ok(
          err.message.includes('missing publicKey or privateKey'),
          `expected field-missing message, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('expands ~ in path', async () => {
    // Write a keyfile inside the homedir temp subdir, then load it via ~/...
    const keyfile = path.join(tmpHomeSubDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    // Build the tilde path: ~/.<basename>/key.json
    const relative = path.relative(os.homedir(), keyfile);
    const tildePath = '~/' + relative;

    const loaded = await loadKeyfile(tildePath);
    assert.equal(loaded.publicKey, kp.publicKey, 'publicKey should match via ~ path');
    assert.equal(loaded.privateKey, kp.privateKey, 'privateKey should match via ~ path');
  });
});

// ---------------------------------------------------------------------------
// signEd25519
// ---------------------------------------------------------------------------

describe('signEd25519', () => {
  it('produces a 128-char hex signature (64 bytes)', async () => {
    const kp = await generateEd25519Key();
    const message = new TextEncoder().encode('hello world');
    const sig = await signEd25519(message, kp.privateKey);
    assert.equal(sig.length, 64, 'signature should be 64 bytes');
    assert.equal(Buffer.from(sig).toString('hex').length, 128, 'hex signature should be 128 chars');
  });

  it('signature is deterministic for same key and message', async () => {
    const kp = await generateEd25519Key();
    const message = new TextEncoder().encode('deterministic test');
    const sig1 = await signEd25519(message, kp.privateKey);
    const sig2 = await signEd25519(message, kp.privateKey);
    assert.deepEqual(
      Buffer.from(sig1).toString('hex'),
      Buffer.from(sig2).toString('hex'),
      'same key+message should produce identical signatures',
    );
  });

  it('different messages produce different signatures', async () => {
    const kp = await generateEd25519Key();
    const msg1 = new TextEncoder().encode('message one');
    const msg2 = new TextEncoder().encode('message two');
    const sig1 = await signEd25519(msg1, kp.privateKey);
    const sig2 = await signEd25519(msg2, kp.privateKey);
    assert.notEqual(
      Buffer.from(sig1).toString('hex'),
      Buffer.from(sig2).toString('hex'),
      'different messages should produce different signatures',
    );
  });
});

// ---------------------------------------------------------------------------
// signSecp256k1
// ---------------------------------------------------------------------------

describe('signSecp256k1', () => {
  it('returns { r, s, v } with r and s as 64-char hex strings', async () => {
    const kp = await generateSecp256k1Key();
    // messageHash must be 32 bytes (as if SHA-256 hash)
    const messageHash = new Uint8Array(32);
    messageHash.fill(0xab);
    const sig = await signSecp256k1(messageHash, kp.privateKey);
    assert.equal(typeof sig.r, 'string', 'r should be a string');
    assert.equal(typeof sig.s, 'string', 's should be a string');
    assert.equal(typeof sig.v, 'number', 'v should be a number');
    assert.equal(sig.r.length, 64, 'r should be 64 hex chars');
    assert.equal(sig.s.length, 64, 's should be 64 hex chars');
    assert.match(sig.r, /^[0-9a-f]{64}$/, 'r should be lowercase hex');
    assert.match(sig.s, /^[0-9a-f]{64}$/, 's should be lowercase hex');
  });

  it('v is 0 (documented limitation of Node.js crypto)', async () => {
    const kp = await generateSecp256k1Key();
    const messageHash = new Uint8Array(32).fill(0x01);
    const sig = await signSecp256k1(messageHash, kp.privateKey);
    assert.equal(sig.v, 0, 'v should always be 0');
  });

  it('different messages produce different signatures', async () => {
    const kp = await generateSecp256k1Key();
    const hash1 = new Uint8Array(32).fill(0x01);
    const hash2 = new Uint8Array(32).fill(0x02);
    const sig1 = await signSecp256k1(hash1, kp.privateKey);
    const sig2 = await signSecp256k1(hash2, kp.privateKey);
    // At least r or s should differ
    const different = sig1.r !== sig2.r || sig1.s !== sig2.s;
    assert.ok(different, 'different messages should produce different signatures');
  });
});

// ---------------------------------------------------------------------------
// withKey
// ---------------------------------------------------------------------------

describe('withKey', () => {
  it('calls fn with the keypair from the keyfile', async () => {
    const keyfile = path.join(tmpDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    let receivedPub = '';
    let receivedPriv = '';
    await withKey(keyfile, async (keypair) => {
      // Capture values inside callback before withKey zeros them
      receivedPub = keypair.publicKey;
      receivedPriv = keypair.privateKey;
    });

    assert.equal(receivedPub, kp.publicKey, 'publicKey should match');
    assert.equal(receivedPriv, kp.privateKey, 'privateKey should match');
  });

  it("returns fn's result", async () => {
    const keyfile = path.join(tmpDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const result = await withKey(keyfile, async (keypair) => {
      return `signed:${keypair.publicKey}`;
    });

    assert.equal(result, `signed:${kp.publicKey}`, "should return fn's return value");
  });

  it('propagates errors thrown by fn (key cleanup still happens)', async () => {
    const keyfile = path.join(tmpDir, 'key.json');
    const kp = await generateEd25519Key();
    await saveKeyfile(keyfile, kp);

    const boom = new Error('something went wrong in fn');
    await assert.rejects(
      () =>
        withKey(keyfile, async () => {
          throw boom;
        }),
      (err: Error) => {
        assert.equal(err, boom, 'the original error should propagate');
        return true;
      },
    );
  });
});



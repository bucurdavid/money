/**
 * providers/bridge.test.ts — Unit tests for money.bridge()
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from '../../src/index.js';
import { _resetAdapterCache } from '../../src/registry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-bridge-test-'));
  process.env.MONEY_CONFIG_DIR = tmpDir;
  originalFetch = globalThis.fetch;
  _resetAdapterCache();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (ORIGINAL_CONFIG_DIR === undefined) {
    delete process.env.MONEY_CONFIG_DIR;
  } else {
    process.env.MONEY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── money.bridge() ─────────────────────────────────────────────────────────

describe('money.bridge', () => {
  it('throws INVALID_PARAMS when from.chain is missing', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: '', token: 'USDC' },
        to: { chain: 'base' },
        amount: 100,
        network: 'mainnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when from.token is missing', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'ethereum', token: '' },
        to: { chain: 'base' },
        amount: 100,
        network: 'mainnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when to.chain is missing', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'ethereum', token: 'USDC' },
        to: { chain: '' },
        amount: 100,
        network: 'mainnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when amount is missing', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'ethereum', token: 'USDC' },
        to: { chain: 'base' },
        amount: undefined as unknown as number,
        network: 'mainnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION when network is testnet', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'ethereum', token: 'USDC' },
        to: { chain: 'base' },
        amount: 100,
        network: 'testnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        assert.ok((err as MoneyError).message.includes('does not support network'));
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION when network defaults to testnet', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'ethereum', token: 'USDC' },
        to: { chain: 'base' },
        amount: 100,
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        return true;
      },
    );
  });

  it('throws CHAIN_NOT_CONFIGURED when source chain is not setup', async () => {
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'ethereum', token: 'USDC' },
        to: { chain: 'base' },
        amount: 100,
        network: 'mainnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('resolves SET token on fast chain (fails at chain config, not token resolution)', async () => {
    // This verifies that "SET" on "fast" no longer throws TOKEN_NOT_FOUND.
    // It should get past token resolution and fail at CHAIN_NOT_CONFIGURED instead.
    await assert.rejects(
      () => money.bridge({
        from: { chain: 'fast', token: 'SET' },
        to: { chain: 'ethereum' },
        amount: 20,
        network: 'testnet',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        // Must NOT be TOKEN_NOT_FOUND — that was the bug
        assert.notEqual((err as MoneyError).code, 'TOKEN_NOT_FOUND');
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });
});

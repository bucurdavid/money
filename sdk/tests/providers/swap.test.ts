/**
 * providers/swap.test.ts — Unit tests for money.quote() and money.swap()
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

const STUB_HEADERS = {
  get: (_name: string) => null,
  has: (_name: string) => false,
  forEach: () => {},
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-swap-test-'));
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

// ─── money.quote() ───────────────────────────────────────────────────────────

describe('money.quote', () => {
  it('throws INVALID_PARAMS when chain is missing', async () => {
    await assert.rejects(
      () => money.quote({ chain: '', from: 'SOL', to: 'USDC', amount: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when from is missing', async () => {
    await assert.rejects(
      () => money.quote({ chain: 'solana', from: '', to: 'USDC', amount: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when to is missing', async () => {
    await assert.rejects(
      () => money.quote({ chain: 'solana', from: 'SOL', to: '', amount: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION when network is testnet', async () => {
    await assert.rejects(
      () => money.quote({ chain: 'solana', from: 'SOL', to: 'USDC', amount: 1, network: 'testnet' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        assert.ok((err as MoneyError).message.includes('mainnet'));
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION when network defaults to testnet', async () => {
    await assert.rejects(
      () => money.quote({ chain: 'solana', from: 'SOL', to: 'USDC', amount: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION for chain with no swap provider', async () => {
    await assert.rejects(
      () => money.quote({ chain: 'fast', from: 'SET', to: 'USDC', amount: 1, network: 'mainnet' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        assert.ok((err as MoneyError).message.includes('No swap provider'));
        return true;
      },
    );
  });
});

// ─── money.swap() ────────────────────────────────────────────────────────────

describe('money.swap', () => {
  it('throws INVALID_PARAMS when chain is missing', async () => {
    await assert.rejects(
      () => money.swap({ chain: '', from: 'SOL', to: 'USDC', amount: 1, network: 'mainnet' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION when network is testnet', async () => {
    await assert.rejects(
      () => money.swap({ chain: 'solana', from: 'SOL', to: 'USDC', amount: 1, network: 'testnet' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        return true;
      },
    );
  });

  it('throws CHAIN_NOT_CONFIGURED when chain is not setup for mainnet', async () => {
    await assert.rejects(
      () => money.swap({ chain: 'solana', from: 'SOL', to: 'USDC', amount: 1, network: 'mainnet' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });
});

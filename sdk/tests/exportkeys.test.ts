/**
 * exportkeys.test.ts — Unit tests for money.exportKeys()
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from '../src/index.js';
import { _resetAdapterCache } from '../src/registry.js';

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

/** Minimal fetch mock for Fast RPC */
function makeFastFetchMock(): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as { method: string; id: number };
    const result = null;
    const body = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result });
    return {
      ok: true, status: 200, headers: STUB_HEADERS,
      json: async () => ({ jsonrpc: '2.0', id: parsed.id, result }),
      text: async () => body, body: null, bodyUsed: false,
    } as unknown as Response;
  }) as FetchFn;
}

/** Minimal fetch mock for EVM RPC */
function makeEvmFetchMock(): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as
      | { method: string; id: number }
      | Array<{ method: string; id: number }>;
    const handlers: Record<string, unknown> = {
      eth_getBalance: '0x0',
      eth_getTransactionCount: '0x0',
      eth_chainId: '0x2105',
    };
    if (Array.isArray(parsed)) {
      const results = parsed.map((req) => ({
        jsonrpc: '2.0', id: req.id,
        result: handlers[req.method] ?? null,
      }));
      const body = JSON.stringify(results);
      return {
        ok: true, status: 200, headers: STUB_HEADERS,
        json: async () => results, text: async () => body,
        body: null, bodyUsed: false,
      } as unknown as Response;
    }
    const result = handlers[parsed.method] ?? null;
    const body = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result });
    return {
      ok: true, status: 200, headers: STUB_HEADERS,
      json: async () => ({ jsonrpc: '2.0', id: parsed.id, result }),
      text: async () => body, body: null, bodyUsed: false,
    } as unknown as Response;
  }) as FetchFn;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-exportkeys-test-'));
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('money.exportKeys', () => {
  it('throws INVALID_PARAMS when chain is missing', async () => {
    await assert.rejects(
      () => money.exportKeys({ chain: '' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws CHAIN_NOT_CONFIGURED when chain is not setup', async () => {
    await assert.rejects(
      () => money.exportKeys({ chain: 'fast' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('exports Fast chain keys', async () => {
    globalThis.fetch = makeFastFetchMock();
    await money.setup({ chain: 'fast' });

    const result = await money.exportKeys({ chain: 'fast' });
    assert.ok(result.address.startsWith('set1'), 'address should start with set1');
    assert.ok(typeof result.privateKey === 'string', 'privateKey should be a string');
    assert.ok(result.privateKey.length === 64, 'Fast private key should be 64 hex chars');
    assert.ok(/^[0-9a-f]+$/i.test(result.privateKey), 'Fast private key should be hex');
    assert.equal(result.chain, 'fast');
    assert.equal(result.chainType, 'fast');
    assert.ok(result.keyfile.includes('fast.json'), 'keyfile should reference fast.json');
    assert.ok(result.note.includes('WARNING'), 'note should contain warning');
  });

  it('exports EVM chain keys with 0x prefix', async () => {
    globalThis.fetch = makeEvmFetchMock();
    await money.setup({ chain: 'base' });

    const result = await money.exportKeys({ chain: 'base' });
    assert.ok(result.address.startsWith('0x'), 'address should start with 0x');
    assert.ok(result.privateKey.startsWith('0x'), 'EVM private key should start with 0x');
    assert.equal(result.privateKey.length, 66, 'EVM private key should be 66 chars (0x + 64 hex)');
    assert.equal(result.chain, 'base');
    assert.equal(result.chainType, 'evm');
    assert.ok(result.keyfile.includes('evm.json'), 'keyfile should reference evm.json');
  });

  it('returns consistent address between setup and exportKeys', async () => {
    globalThis.fetch = makeFastFetchMock();
    const setupResult = await money.setup({ chain: 'fast' });
    const exportResult = await money.exportKeys({ chain: 'fast' });
    assert.equal(exportResult.address, setupResult.address, 'exported address should match setup address');
  });

  it('returns same EVM key for different EVM chains', async () => {
    globalThis.fetch = makeEvmFetchMock();
    await money.setup({ chain: 'base' });
    await money.setup({ chain: 'ethereum' });

    const baseKeys = await money.exportKeys({ chain: 'base' });
    const ethKeys = await money.exportKeys({ chain: 'ethereum' });
    assert.equal(baseKeys.privateKey, ethKeys.privateKey, 'EVM chains should share the same private key');
    assert.equal(baseKeys.address, ethKeys.address, 'EVM chains should share the same address');
  });
});

/**
 * sign.test.ts — Unit tests for money.sign()
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

/** Minimal fetch mock for Fast RPC (just enough for setupWallet) */
function makeFastFetchMock(): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as { method: string; id: number };
    const handlers: Record<string, unknown> = {
      proxy_getAccountInfo: null,
    };
    const result = handlers[parsed.method] ?? null;
    const body = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result });
    return {
      ok: true,
      status: 200,
      headers: STUB_HEADERS,
      json: async () => ({ jsonrpc: '2.0', id: parsed.id, result }),
      text: async () => body,
      body: null,
      bodyUsed: false,
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
        jsonrpc: '2.0',
        id: req.id,
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-sign-test-'));
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

describe('money.sign', () => {
  it('throws INVALID_PARAMS when chain is missing', async () => {
    await assert.rejects(
      () => money.sign({ chain: '', message: 'hello' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when message is missing', async () => {
    await assert.rejects(
      () => money.sign({ chain: 'fast', message: undefined as unknown as string }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws CHAIN_NOT_CONFIGURED when chain is not setup', async () => {
    await assert.rejects(
      () => money.sign({ chain: 'fast', message: 'hello' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('signs a message on fast chain and returns hex signature', async () => {
    globalThis.fetch = makeFastFetchMock();
    await money.setup({ chain: 'fast' });

    const result = await money.sign({ chain: 'fast', message: 'Test message' });
    assert.ok(result.signature, 'should have a signature');
    assert.ok(typeof result.signature === 'string', 'signature should be a string');
    // Fast signatures are hex (128 chars = 64 bytes)
    assert.ok(/^[0-9a-f]+$/i.test(result.signature), 'signature should be hex');
    assert.ok(result.address.startsWith('set1'), 'address should be set1...');
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.equal(result.note, '');
  });

  it('signs a message on EVM chain (base) and returns 0x hex signature', async () => {
    globalThis.fetch = makeEvmFetchMock();
    await money.setup({ chain: 'base' });

    const result = await money.sign({ chain: 'base', message: 'Test message' });
    assert.ok(result.signature.startsWith('0x'), 'EVM signature should start with 0x');
    assert.ok(result.address.startsWith('0x'), 'EVM address should start with 0x');
    assert.equal(result.chain, 'base');
    assert.equal(result.network, 'testnet');
  });

  it('produces deterministic signatures for same key and message on fast', async () => {
    globalThis.fetch = makeFastFetchMock();
    await money.setup({ chain: 'fast' });

    const result1 = await money.sign({ chain: 'fast', message: 'Deterministic test' });
    const result2 = await money.sign({ chain: 'fast', message: 'Deterministic test' });
    assert.equal(result1.signature, result2.signature, 'same message should produce same signature');
    assert.equal(result1.address, result2.address, 'same address');
  });

  it('produces different signatures for different messages', async () => {
    globalThis.fetch = makeFastFetchMock();
    await money.setup({ chain: 'fast' });

    const result1 = await money.sign({ chain: 'fast', message: 'Message A' });
    const result2 = await money.sign({ chain: 'fast', message: 'Message B' });
    assert.notEqual(result1.signature, result2.signature, 'different messages should produce different signatures');
  });

  it('can sign a Uint8Array message', async () => {
    globalThis.fetch = makeFastFetchMock();
    await money.setup({ chain: 'fast' });

    const msg = new TextEncoder().encode('Binary message');
    const result = await money.sign({ chain: 'fast', message: msg });
    assert.ok(result.signature, 'should produce a signature from Uint8Array');
  });
});

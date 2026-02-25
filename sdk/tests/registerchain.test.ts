/**
 * registerchain.test.ts — Unit tests for money.registerEvmChain
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from '../src/index.js';
import { _resetAdapterCache } from '../src/registry.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

/** Minimal headers stub for viem compatibility */
const STUB_HEADERS = {
  get: (_name: string) => null,
  has: (_name: string) => false,
  forEach: () => {},
};

function makeEvmFetchMock(): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as
      | { method: string; id: number }
      | Array<{ method: string; id: number }>;
    const handlers: Record<string, unknown> = {
      eth_getBalance: '0x0',
      eth_getTransactionCount: '0x0',
      eth_chainId: '0x89',
    };

    if (Array.isArray(parsed)) {
      const results = parsed.map((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        result: handlers[req.method] ?? null,
      }));
      const body = JSON.stringify(results);
      return {
        ok: true,
        status: 200,
        headers: STUB_HEADERS,
        json: async () => results,
        text: async () => body,
        body: null,
        bodyUsed: false,
      } as unknown as Response;
    }

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

// ─── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-registerchain-test-'));
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

// ─── money.registerEvmChain ───────────────────────────────────────────────────

describe('money.registerEvmChain', () => {
  it('registers a custom EVM chain and persists to config', async () => {
    await money.registerEvmChain({
      chain: 'mychain',
      chainId: 99999,
      rpc: 'https://mychain-rpc.com',
      explorer: 'https://mychainscan.com/tx/',
      defaultToken: 'MYC',
      network: 'mainnet',
    });

    // Verify customChains was written to config.json
    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    assert.ok(config.customChains?.mychain, 'customChains should contain mychain');
    assert.equal(config.customChains.mychain.chainId, 99999);
    assert.equal(config.customChains.mychain.type, 'evm');

    // Verify chain config was written
    assert.ok(config.chains['mychain:mainnet'], 'chains should contain mychain:mainnet');
    assert.equal(config.chains['mychain:mainnet'].rpc, 'https://mychain-rpc.com');
    assert.equal(config.chains['mychain:mainnet'].defaultToken, 'MYC');
    assert.equal(config.chains['mychain:mainnet'].keyfile, '~/.money/keys/evm.json');
  });

  it('rejects built-in chain names', async () => {
    await assert.rejects(
      () => money.registerEvmChain({ chain: 'base', chainId: 8453, rpc: 'https://example.com' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        assert.ok((err as MoneyError).message.includes('built-in'));
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when chainId is missing', async () => {
    await assert.rejects(
      () => money.registerEvmChain({ chain: 'mychain', rpc: 'https://mychain-rpc.com' } as any),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when rpc is missing', async () => {
    await assert.rejects(
      () => money.registerEvmChain({ chain: 'mychain', chainId: 99999 } as any),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('defaults to ETH when defaultToken is not provided', async () => {
    await money.registerEvmChain({
      chain: 'testchain',
      chainId: 88888,
      rpc: 'https://testchain-rpc.com',
    });

    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    assert.equal(config.chains['testchain'].defaultToken, 'ETH');
  });

  it('defaults to testnet when network is not provided', async () => {
    await money.registerEvmChain({
      chain: 'testchain',
      chainId: 88888,
      rpc: 'https://testchain-rpc.com',
    });

    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    assert.ok(config.chains['testchain'], 'should use bare chain name for testnet');
    assert.equal(config.chains['testchain'].network, 'testnet');
  });

  it('setup works after registerEvmChain', async () => {
    globalThis.fetch = makeEvmFetchMock();

    await money.registerEvmChain({
      chain: 'mychain',
      chainId: 99999,
      rpc: 'https://mychain-rpc.com',
      network: 'mainnet',
    });

    const result = await money.setup({ chain: 'mychain', network: 'mainnet' });
    assert.equal(result.chain, 'mychain');
    assert.equal(result.network, 'mainnet');
    assert.ok(result.address.startsWith('0x'), 'should return EVM address');
  });

  it('balance returns custom native token symbol (not ETH)', async () => {
    globalThis.fetch = makeEvmFetchMock();

    await money.registerEvmChain({
      chain: 'mychain',
      chainId: 99999,
      rpc: 'https://mychain-rpc.com',
      defaultToken: 'MYC',
      network: 'mainnet',
    });

    const setupResult = await money.setup({ chain: 'mychain', network: 'mainnet' });
    const balResult = await money.balance({ chain: 'mychain', network: 'mainnet' });

    assert.equal(balResult.token, 'MYC', 'token label should be MYC, not ETH');
    assert.equal(balResult.amount, '0', 'mock returns zero balance');
    assert.equal(balResult.address, setupResult.address);
  });
});

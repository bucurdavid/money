/**
 * mainnet.test.ts — Tests for mainnet support in money SDK
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from './index.js';
import { _resetAdapterCache } from './registry.js';
import { configKey, parseConfigKey } from './defaults.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

function fastTestnetConfig(tmpDir: string) {
  return {
    rpc: 'https://proxy.fastset.xyz',
    keyfile: path.join(tmpDir, 'keys', 'fast.json'),
    network: 'testnet',
    defaultToken: 'SET',
  };
}

function fastMainnetConfig(tmpDir: string) {
  return {
    rpc: 'https://proxy.fastset.xyz',
    keyfile: path.join(tmpDir, 'keys', 'fast.json'),
    network: 'mainnet',
    defaultToken: 'SET',
  };
}

async function seedConfig(tmpDir: string, chains: Record<string, unknown> = {}) {
  await fs.mkdir(tmpDir, { recursive: true });
  const config = { chains: { fast: fastTestnetConfig(tmpDir), ...chains } };
  await fs.writeFile(
    path.join(tmpDir, 'config.json'),
    JSON.stringify(config, null, 2),
    { encoding: 'utf-8', mode: 0o600 },
  );
}

function makeFetchMock(
  handlers: Record<string, unknown>,
): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as { method: string };
    const result = handlers[parsed.method] ?? null;
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result }),
    } as Response;
  }) as FetchFn;
}

// ─── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-mainnet-test-'));
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

// ─── configKey / parseConfigKey ──────────────────────────────────────────────

describe('configKey', () => {
  it('returns bare chain name for testnet', () => {
    assert.equal(configKey('fast', 'testnet'), 'fast');
  });

  it('returns chain:mainnet for mainnet', () => {
    assert.equal(configKey('fast', 'mainnet'), 'fast:mainnet');
  });
});

describe('parseConfigKey', () => {
  it('parses bare chain name as testnet', () => {
    const result = parseConfigKey('fast');
    assert.deepEqual(result, { chain: 'fast', network: 'testnet' });
  });

  it('parses chain:mainnet', () => {
    const result = parseConfigKey('fast:mainnet');
    assert.deepEqual(result, { chain: 'fast', network: 'mainnet' });
  });
});

// ─── money.setup with network option ────────────────────────────────────────

describe('money.setup mainnet', () => {
  it('defaults to testnet when no options provided (backward compat)', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup({ chain: 'fast' });
    assert.equal(result.network, 'testnet');
    assert.equal(result.chain, 'fast');
    assert.ok(result.address.startsWith('set1'));
  });

  it('sets up mainnet when { network: "mainnet" } passed', async () => {
    await seedConfig(tmpDir, { 'fast:mainnet': fastMainnetConfig(tmpDir) });
    const result = await money.setup({ chain: 'fast', network: 'mainnet' });
    assert.equal(result.network, 'mainnet');
    assert.equal(result.chain, 'fast');
    assert.ok(result.address.startsWith('set1'));
  });

  it('testnet and mainnet share the same keyfile and address', async () => {
    await seedConfig(tmpDir, { 'fast:mainnet': fastMainnetConfig(tmpDir) });
    const testnet = await money.setup({ chain: 'fast' });
    const mainnet = await money.setup({ chain: 'fast', network: 'mainnet' });

    // Same keyfile → same key → same address on both networks
    assert.ok(testnet.address.startsWith('set1'));
    assert.ok(mainnet.address.startsWith('set1'));
    assert.equal(testnet.address, mainnet.address, 'testnet and mainnet should have the same address');
  });

  it('testnet and mainnet configs coexist in config.json', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    await money.setup({ chain: 'fast', network: 'mainnet' });

    // Read config directly
    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw) as { chains: Record<string, unknown> };

    assert.ok('fast' in config.chains, 'testnet config should exist at key "fast"');
    assert.ok('fast:mainnet' in config.chains, 'mainnet config should exist at key "fast:mainnet"');
  });
});

// ─── Faucet gating ──────────────────────────────────────────────────────────

describe('faucet mainnet gating', () => {
  it('faucet throws on mainnet for fast', async () => {
    await seedConfig(tmpDir, { 'fast:mainnet': fastMainnetConfig(tmpDir) });
    await money.setup({ chain: 'fast', network: 'mainnet' });

    await assert.rejects(
      () => money.faucet({ chain: 'fast', network: 'mainnet' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got ${String(err)}`);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        assert.ok((err as MoneyError).message.includes('mainnet'));
        return true;
      },
    );
  });

  it('faucet still works on testnet for fast', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });

    globalThis.fetch = makeFetchMock({
      proxy_faucetDrip: null,
      proxy_getAccountInfo: { balance: '21e19e0c9bab2400000', next_nonce: 1 },
    });

    const result = await money.faucet({ chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(parseFloat(result.amount) > 0);
  });
});

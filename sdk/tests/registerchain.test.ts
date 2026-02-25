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

function makeEvmFetchMock(): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as { method: string };
    const handlers: Record<string, unknown> = {
      eth_getBalance: '0x0',
      eth_getTransactionCount: '0x0',
      eth_chainId: '0x89',
    };
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: handlers[parsed.method] ?? null }),
    } as Response;
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
      chain: 'polygon',
      chainId: 137,
      rpc: 'https://polygon-rpc.com',
      explorer: 'https://polygonscan.com/tx/',
      defaultToken: 'MATIC',
      network: 'mainnet',
    });

    // Verify customChains was written to config.json
    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    assert.ok(config.customChains?.polygon, 'customChains should contain polygon');
    assert.equal(config.customChains.polygon.chainId, 137);
    assert.equal(config.customChains.polygon.type, 'evm');

    // Verify chain config was written
    assert.ok(config.chains['polygon:mainnet'], 'chains should contain polygon:mainnet');
    assert.equal(config.chains['polygon:mainnet'].rpc, 'https://polygon-rpc.com');
    assert.equal(config.chains['polygon:mainnet'].defaultToken, 'MATIC');
    assert.equal(config.chains['polygon:mainnet'].keyfile, '~/.money/keys/evm.json');
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
      () => money.registerEvmChain({ chain: 'polygon', rpc: 'https://polygon-rpc.com' } as any),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when rpc is missing', async () => {
    await assert.rejects(
      () => money.registerEvmChain({ chain: 'polygon', chainId: 137 } as any),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('defaults to ETH when defaultToken is not provided', async () => {
    await money.registerEvmChain({
      chain: 'optimism',
      chainId: 10,
      rpc: 'https://optimism-rpc.com',
    });

    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    assert.equal(config.chains['optimism'].defaultToken, 'ETH');
  });

  it('defaults to testnet when network is not provided', async () => {
    await money.registerEvmChain({
      chain: 'optimism',
      chainId: 10,
      rpc: 'https://optimism-rpc.com',
    });

    const raw = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(raw);
    assert.ok(config.chains['optimism'], 'should use bare chain name for testnet');
    assert.equal(config.chains['optimism'].network, 'testnet');
  });

  it('setup works after registerEvmChain', async () => {
    globalThis.fetch = makeEvmFetchMock();

    await money.registerEvmChain({
      chain: 'polygon',
      chainId: 137,
      rpc: 'https://polygon-rpc.com',
      network: 'mainnet',
    });

    const result = await money.setup({ chain: 'polygon', network: 'mainnet' });
    assert.equal(result.chain, 'polygon');
    assert.equal(result.network, 'mainnet');
    assert.ok(result.address.startsWith('0x'), 'should return EVM address');
  });
});

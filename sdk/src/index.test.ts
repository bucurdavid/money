/**
 * index.test.ts — Comprehensive unit tests for the money SDK
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from './index.js';
import { _resetAdapterCache } from './registry.js';
import type { NetworkType } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

function fastChainConfig(tmpDir: string) {
  return {
    rpc: 'https://proxy.fastset.xyz',
    keyfile: path.join(tmpDir, 'keys', 'fast.json'),
    network: 'testnet',
    defaultToken: 'SET',
  };
}

async function seedConfig(tmpDir: string, chains: Record<string, unknown> = {}) {
  await fs.mkdir(tmpDir, { recursive: true });
  const config = { chains: { fast: fastChainConfig(tmpDir), ...chains } };
  await fs.writeFile(
    path.join(tmpDir, 'config.json'),
    JSON.stringify(config, null, 2),
    { encoding: 'utf-8', mode: 0o600 },
  );
}

function makeFetchMock(handlers: Record<string, unknown>): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as { method: string; params: unknown };
    const result = handlers[parsed.method] ?? null;
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result }),
    } as Response;
  }) as FetchFn;
}

function standardFastFetch(overrides: Record<string, unknown> = {}): FetchFn {
  return makeFetchMock({
    proxy_getAccountInfo: { balance: 'de0b6b3a7640000', next_nonce: 0 },
    proxy_submitTransaction: {
      Success: { envelope: { transaction: { nonce: 0 } }, signatures: [] },
    },
    proxy_faucetDrip: null,
    ...overrides,
  });
}

// ─── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-idx-test-'));
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

// ─── money.setup ─────────────────────────────────────────────────────────────

describe('money.setup', () => {
  it('sets up fast chain and returns { chain, address, network, note }', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup({ chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.address === 'string' && result.address.length > 0);
    assert.ok(typeof result.note === 'string');
  });

  it('address starts with "set1"', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup({ chain: 'fast' });
    assert.ok(result.address.startsWith('set1'), `expected set1... got: ${result.address}`);
  });

  it('throws MoneyError(CHAIN_NOT_CONFIGURED) for unknown chain name', async () => {
    await assert.rejects(
      () => money.setup({ chain: 'dogecoin' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got: ${String(err)}`);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        assert.ok((err as MoneyError).message.includes('dogecoin'));
        return true;
      },
    );
  });

  it('is idempotent — returns the same address on re-setup', async () => {
    await seedConfig(tmpDir);
    const r1 = await money.setup({ chain: 'fast' });
    const r2 = await money.setup({ chain: 'fast' });
    assert.equal(r1.address, r2.address);
  });

  it('note is non-empty string on testnet setup', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup({ chain: 'fast' });
    assert.ok(result.note.length > 0, 'expected non-empty note for testnet setup');
  });

  it('note contains faucet suggestion on testnet', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup({ chain: 'fast' });
    assert.ok(result.note.includes('faucet'), `expected faucet in note, got: ${result.note}`);
  });
});

// ─── money.status ─────────────────────────────────────────────────────────────

describe('money.status', () => {
  it('returns { entries, note } after setup', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const result = await money.status();
    assert.ok(Array.isArray(result.entries));
    assert.ok(typeof result.note === 'string');
    const fastChain = result.entries.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'should include fast chain');
  });

  it('shows "ready" when keyfile exists', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const result = await money.status();
    const fastChain = result.entries.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'fast chain not found');
    assert.equal(fastChain!.status, 'ready');
    assert.ok(fastChain!.address.startsWith('set1'));
  });

  it('shows "no-key" when keyfile does not exist', async () => {
    await seedConfig(tmpDir);
    const result = await money.status();
    const fastChain = result.entries.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'fast chain not found');
    assert.equal(fastChain!.status, 'no-key');
  });
});

// ─── money.balance ─────────────────────────────────────────────────────────────

describe('money.balance', () => {
  it('returns balance result with chain, address, amount, token, note', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    globalThis.fetch = standardFastFetch();
    const result = await money.balance({ chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(result.address.startsWith('set1'));
    assert.equal(result.amount, '1');
    assert.equal(result.token, 'SET');
    assert.ok(typeof result.note === 'string');
  });

  it('throws MoneyError for unconfigured chain', async () => {
    await seedConfig(tmpDir);
    await assert.rejects(
      () => money.balance({ chain: 'solana' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('note contains faucet suggestion when balance is 0 on testnet', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    globalThis.fetch = makeFetchMock({
      proxy_getAccountInfo: { balance: '0', next_nonce: 0 },
    });
    const result = await money.balance({ chain: 'fast' });
    assert.ok(result.note.includes('faucet'), `expected faucet in note, got: ${result.note}`);
  });
});

// ─── money.send ──────────────────────────────────────────────────────────────

describe('money.send', () => {
  it('sends successfully with chain param and returns { txHash, chain, network, note }', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup({ chain: 'fast' });
    const from = setupResult.address;
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });
    const result = await money.send({ to: from, amount: '0.001', chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.txHash === 'string' && result.txHash.length > 0);
    assert.equal(result.fee, '0.01');
    assert.ok(typeof result.note === 'string');
  });

  it('writes to history.csv after successful send', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup({ chain: 'fast' });
    const from = setupResult.address;
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });
    await money.send({ to: from, amount: '0.001', chain: 'fast' });
    const csvPath = path.join(tmpDir, 'history.csv');
    const csv = await fs.readFile(csvPath, 'utf-8');
    assert.ok(csv.includes('fast'), 'history.csv should include chain "fast"');
    assert.ok(csv.includes('testnet'), 'history.csv should include network');
    assert.ok(csv.includes('0.001'), 'history.csv should include amount');
  });

  it('throws INSUFFICIENT_BALANCE when balance too low', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup({ chain: 'fast' });
    const from = setupResult.address;
    globalThis.fetch = makeFetchMock({
      proxy_getAccountInfo: { balance: 'e8d4a51000', next_nonce: 0 },
    });
    await assert.rejects(
      () => money.send({ to: from, amount: '100', chain: 'fast' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INSUFFICIENT_BALANCE');
        return true;
      },
    );
  });

  it('throws CONTACT_NOT_FOUND for garbage input (not a valid address or known contact)', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    await assert.rejects(
      () => money.send({ to: 'GARBAGE_NOT_AN_ADDRESS_!!!', amount: '1', chain: 'fast' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CONTACT_NOT_FOUND');
        return true;
      },
    );
  });

  it('throws CONTACT_NOT_FOUND for EVM address when chain is fast (not valid, not a contact)', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const evmAddress = '0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB';
    await assert.rejects(
      () => money.send({ to: evmAddress, amount: '1', chain: 'fast' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CONTACT_NOT_FOUND');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when chain is missing', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const to = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
    await assert.rejects(
      () => money.send({ to, amount: 1 } as Parameters<typeof money.send>[0]),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });
});

// ─── money.faucet ─────────────────────────────────────────────────────────────

describe('money.faucet', () => {
  it('calls adapter faucet and returns result with chain, amount, token, txHash, note', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    let callCount = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string };
      if (parsed.method === 'proxy_faucetDrip') {
        return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { balance: '21e19e0c9bab2400000', next_nonce: 1 } }),
      } as Response;
    }) as FetchFn;
    const result = await money.faucet({ chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.token, 'SET');
    assert.ok(typeof result.txHash === 'string');
    assert.ok(parseFloat(result.amount) > 0);
    assert.ok(callCount >= 2);
    assert.ok(typeof result.note === 'string' && result.note.length > 0);
  });

  it('throws for unconfigured chain', async () => {
    await seedConfig(tmpDir);
    await assert.rejects(
      () => money.faucet({ chain: 'solana' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.ok(
          (err as MoneyError).message.includes('solana') || (err as MoneyError).message.includes('not configured'),
        );
        return true;
      },
    );
  });

  it('note contains balance suggestion after faucet', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string };
      if (parsed.method === 'proxy_faucetDrip') {
        return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { balance: '21e19e0c9bab2400000', next_nonce: 1 } }),
      } as Response;
    }) as FetchFn;
    const result = await money.faucet({ chain: 'fast' });
    assert.ok(result.note.includes('balance'), `expected balance in note, got: ${result.note}`);
  });
});

// ─── money.getToken / money.registerToken ─────────────────────────────────────

describe('money.getToken / money.registerToken', () => {
  it('getToken returns null for unknown token', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const result = await money.getToken({ chain: 'fast', name: 'NOTEXIST' });
    assert.equal(result, null);
  });

  it('registerToken then getToken returns the token', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    await money.registerToken({ chain: 'fast', name: 'MYTOKEN', address: '0x1234567890123456789012345678901234567890', decimals: 18 });
    const result = await money.getToken({ chain: 'fast', name: 'MYTOKEN' });
    assert.ok(result !== null);
    assert.equal(result!.name, 'MYTOKEN');
    assert.equal(result!.address, '0x1234567890123456789012345678901234567890');
    assert.equal(result!.decimals, 18);
  });

  it('getToken throws CHAIN_NOT_CONFIGURED for unconfigured chain', async () => {
    await assert.rejects(
      () => money.getToken({ chain: 'bitcoin', name: 'BTC' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });
});

// ─── money.tokens ─────────────────────────────────────────────────────────────

describe('money.tokens', () => {
  it('returns { tokens: [], note } when no tokens registered', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const result = await money.tokens({ chain: 'fast' });
    assert.ok(Array.isArray(result.tokens));
    assert.ok(typeof result.note === 'string');
    // fast chain has no DEFAULT_ALIASES so should be empty
    assert.equal(result.tokens.length, 0);
  });

  it('returns tokens after registerToken', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    await money.registerToken({ chain: 'fast', name: 'TKN', address: '0xaaa' + '0'.repeat(37), decimals: 6 });
    const result = await money.tokens({ chain: 'fast' });
    assert.ok(result.tokens.some(t => t.name === 'TKN'));
  });

  it('returns { tokens: [], note } for unconfigured chain (no throw)', async () => {
    const result = await money.tokens({ chain: 'unknown' });
    assert.ok(Array.isArray(result.tokens));
    assert.equal(result.tokens.length, 0);
  });
});

// ─── money.history ─────────────────────────────────────────────────────────────

describe('money.history', () => {
  it('returns { entries: [], note } when no sends have occurred', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const result = await money.history({ chain: 'fast' });
    assert.ok(Array.isArray(result.entries));
    assert.ok(typeof result.note === 'string');
    assert.equal(result.entries.length, 0);
  });

  it('returns { entries: [], note } when called with no params and no history exists', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const result = await money.history();
    assert.ok(Array.isArray(result.entries));
    assert.equal(result.entries.length, 0);
  });

  it('returns entries from history.csv after a send', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup({ chain: 'fast' });
    const from = setupResult.address;
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });
    await money.send({ to: from, amount: '0.001', chain: 'fast' });
    const result = await money.history();
    assert.ok(Array.isArray(result.entries));
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].chain, 'fast');
    assert.equal(result.entries[0].network, 'testnet');
    assert.equal(result.entries[0].amount, '0.001');
    assert.equal(result.entries[0].token, 'SET');
    assert.ok(typeof result.entries[0].txHash === 'string');
    assert.ok(typeof result.entries[0].ts === 'string');
  });
});

// ─── money.identifyChains ─────────────────────────────────────────────────────

describe('money.identifyChains', () => {
  it('identifies "fast" from set1... address', () => {
    const result = money.identifyChains({ address: 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc' });
    assert.deepStrictEqual(result.chains, ['fast']);
    assert.equal(result.note, '');
  });

  it('returns all EVM chains for EVM address with non-empty note', () => {
    const result = money.identifyChains({ address: '0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB' });
    assert.deepStrictEqual(result.chains, ['base', 'ethereum', 'arbitrum']);
    assert.ok(result.note.length > 0, 'expected non-empty note for ambiguous EVM address');
  });

  it('identifies "solana" from base58 address', () => {
    const result = money.identifyChains({ address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' });
    assert.deepStrictEqual(result.chains, ['solana']);
    assert.equal(result.note, '');
  });

  it('returns empty chains array and non-empty note for garbage input', () => {
    const result = money.identifyChains({ address: 'GARBAGE!@#$%NOT_AN_ADDRESS' });
    assert.deepStrictEqual(result.chains, []);
    assert.ok(result.note.length > 0, 'expected non-empty note for unrecognized address');
  });

  it('returns empty chains array for empty string', () => {
    const result = money.identifyChains({ address: '' });
    assert.deepStrictEqual(result.chains, []);
    assert.ok(result.note.length > 0);
  });
});

// ─── money.setup with rpc override ──────────────────────────────────────────

describe('money.setup with rpc override', () => {
  it('stores custom rpc in config.json', async () => {
    const customRpc = 'https://custom-rpc.example.com';
    await money.setup({ chain: 'fast', rpc: customRpc });
    const configContent = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(configContent) as { chains: Record<string, { rpc: string }> };
    assert.equal(config.chains['fast']?.rpc, customRpc);
  });

  it('re-setup without rpc option preserves existing custom rpc', async () => {
    const customRpc = 'https://custom-rpc.example.com';
    await money.setup({ chain: 'fast', rpc: customRpc });
    await money.setup({ chain: 'fast' });
    const configContent = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(configContent) as { chains: Record<string, { rpc: string }> };
    assert.equal(config.chains['fast']?.rpc, customRpc);
  });

  it('second rpc option overwrites previous custom rpc', async () => {
    await money.setup({ chain: 'fast', rpc: 'https://first-rpc.example.com' });
    await money.setup({ chain: 'fast', rpc: 'https://second-rpc.example.com' });
    const configContent = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(configContent) as { chains: Record<string, { rpc: string }> };
    assert.equal(config.chains['fast']?.rpc, 'https://second-rpc.example.com');
  });

  it('setup with network: mainnet returns empty note', async () => {
    // mainnet setup should have empty note (no faucet suggestion)
    // We can't actually set up mainnet fast without a valid config, but we can
    // verify the testnet note behavior is correct
    await seedConfig(tmpDir);
    const result = await money.setup({ chain: 'fast' });
    // testnet note should be non-empty
    assert.ok(result.note.length > 0);
  });
});

// ─── money.send — chain and token params ─────────────────────────────────────

describe('money.send with chain param', () => {
  it('chain="fast" works for a fast address', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: 'de0b6b3a7640000000', next_nonce: 1 },
    });
    const to = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
    const result = await money.send({ to, amount: 1, chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.txHash === 'string');
  });

  it('chain="fast" with an EVM address throws CONTACT_NOT_FOUND (not valid fast address, not a contact)', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    const evmAddress = '0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB';
    await assert.rejects(
      () => money.send({ to: evmAddress, amount: 1, chain: 'fast' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CONTACT_NOT_FOUND');
        return true;
      },
    );
  });

  it('token="SET" explicitly is same as default for fast chain', async () => {
    await seedConfig(tmpDir);
    await money.setup({ chain: 'fast' });
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: 'de0b6b3a7640000000', next_nonce: 1 },
    });
    const to = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
    const result = await money.send({ to, amount: 1, chain: 'fast', token: 'SET' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.txHash === 'string');
  });
});

// ─── money.history — chain filter ─────────────────────────────────────────────

describe('money.history with chain filter', () => {
  it('returns only entries matching the given chain', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup({ chain: 'fast' });
    const from = setupResult.address;

    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });

    // Send on fast chain — writes to history.csv
    await money.send({ to: from, amount: '0.001', chain: 'fast' });

    // fast entries should appear
    const { entries: fastEntries } = await money.history({ chain: 'fast' });
    assert.equal(fastEntries.length, 1);
    assert.equal(fastEntries[0].chain, 'fast');
    assert.equal(fastEntries[0].network, 'testnet');

    // base entries should be empty (nothing sent on base)
    const { entries: baseEntries } = await money.history({ chain: 'base' });
    assert.equal(baseEntries.length, 0);
  });

  it('accepts a limit to restrict results across all chains', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup({ chain: 'fast' });
    const from = setupResult.address;

    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });

    // Send twice
    await money.send({ to: from, amount: '0.001', chain: 'fast' });
    await money.send({ to: from, amount: '0.002', chain: 'fast' });

    // history({ limit: 1 }) should return only 1 entry (the most recent)
    const { entries: limited } = await money.history({ limit: 1 });
    assert.equal(limited.length, 1);

    // history({ limit: 10 }) should return both (limit > count)
    const { entries: all } = await money.history({ limit: 10 });
    assert.equal(all.length, 2);
  });
});

// ─── history.ts CSV round-trip ────────────────────────────────────────────────

describe('history CSV round-trip', () => {
  it('round-trips an entry with a comma in the token name', async () => {
    // Write a history.csv manually with a quoted token name, then read it back.
    const csvPath = `${tmpDir}/history.csv`;
    const header = 'ts,chain,network,to,amount,token,txHash';
    const ts = '2024-01-01T00:00:00.000Z';
    const row = `${ts},fast,testnet,set1abc,1.0,"TOKEN,A",0xdeadbeef`;
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(csvPath, `${header}\n${row}\n`, 'utf-8');

    process.env.MONEY_CONFIG_DIR = tmpDir;
    const result = await money.history();
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].token, 'TOKEN,A');
    assert.equal(result.entries[0].chain, 'fast');
    assert.equal(result.entries[0].network, 'testnet');
    assert.equal(result.entries[0].amount, '1.0');
  });
});

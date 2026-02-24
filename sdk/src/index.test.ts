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
  it('sets up fast chain and returns { chain, address, network }', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup('fast');
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.address === 'string' && result.address.length > 0);
  });

  it('address starts with "set1"', async () => {
    await seedConfig(tmpDir);
    const result = await money.setup('fast');
    assert.ok(result.address.startsWith('set1'), `expected set1... got: ${result.address}`);
  });

  it('throws MoneyError(CHAIN_NOT_CONFIGURED) for unknown chain name', async () => {
    await assert.rejects(
      () => money.setup('dogecoin'),
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
    const r1 = await money.setup('fast');
    const r2 = await money.setup('fast');
    assert.equal(r1.address, r2.address);
  });
});

// ─── money.chains ─────────────────────────────────────────────────────────────

describe('money.chains', () => {
  it('returns status for configured chains after setup', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const chains = await money.chains();
    assert.ok(Array.isArray(chains));
    const fastChain = chains.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'should include fast chain');
  });

  it('shows "ready" when keyfile exists', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const chains = await money.chains();
    const fastChain = chains.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'fast chain not found');
    assert.equal(fastChain!.status, 'ready');
    assert.ok(fastChain!.address.startsWith('set1'));
  });

  it('shows "no-key" when keyfile does not exist', async () => {
    await seedConfig(tmpDir);
    const chains = await money.chains();
    const fastChain = chains.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'fast chain not found');
    assert.equal(fastChain!.status, 'no-key');
  });
});

// ─── money.wallets ─────────────────────────────────────────────────────────────

describe('money.wallets', () => {
  it('returns balances for configured chains (mock RPC balance)', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    globalThis.fetch = standardFastFetch();
    const wallets = await money.wallets();
    assert.ok(Array.isArray(wallets));
    const fastWallet = wallets.find(w => w.chain === 'fast');
    assert.ok(fastWallet, 'fast wallet not found');
    assert.ok(fastWallet!.address.startsWith('set1'));
    assert.equal(fastWallet!.balances['SET'], '1');
  });
});

// ─── money.balance ─────────────────────────────────────────────────────────────

describe('money.balance', () => {
  it('single chain: returns balance result with chain, address, amount, token', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    globalThis.fetch = standardFastFetch();
    const result = await money.balance('fast');
    assert.ok(!Array.isArray(result));
    const bal = result as { chain: string; network: string; address: string; amount: string; token: string };
    assert.equal(bal.chain, 'fast');
    assert.equal(bal.network, 'testnet');
    assert.ok(bal.address.startsWith('set1'));
    assert.equal(bal.amount, '1');
    assert.equal(bal.token, 'SET');
  });

  it('throws MoneyError for unconfigured chain', async () => {
    await seedConfig(tmpDir);
    await assert.rejects(
      () => money.balance('solana'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('returns array of balances when no chain specified', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    globalThis.fetch = standardFastFetch();
    const results = await money.balance();
    assert.ok(Array.isArray(results));
    const fastBal = (results as Array<{ chain: string; amount: string }>).find(r => r.chain === 'fast');
    assert.ok(fastBal, 'fast balance not found');
    assert.equal(fastBal!.amount, '1');
  });
});

// ─── money.send ──────────────────────────────────────────────────────────────

describe('money.send', () => {
  it('auto-detects chain from set1... address and sends successfully', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });
    const result = await money.send(from, '0.001');
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.txHash === 'string' && result.txHash.length > 0);
    assert.equal(result.fee, '0.01');
  });

  it('writes to history.csv after successful send', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });
    await money.send(from, '0.001');
    const csvPath = path.join(tmpDir, 'history.csv');
    const csv = await fs.readFile(csvPath, 'utf-8');
    assert.ok(csv.includes('fast'), 'history.csv should include chain "fast"');
    assert.ok(csv.includes('testnet'), 'history.csv should include network');
    assert.ok(csv.includes('0.001'), 'history.csv should include amount');
  });

  it('throws INSUFFICIENT_BALANCE when balance too low', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;
    globalThis.fetch = makeFetchMock({
      proxy_getAccountInfo: { balance: 'e8d4a51000', next_nonce: 0 },
    });
    await assert.rejects(
      () => money.send(from, '100'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INSUFFICIENT_BALANCE');
        return true;
      },
    );
  });

  it('throws INVALID_ADDRESS for garbage input', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    await assert.rejects(
      () => money.send('GARBAGE_NOT_AN_ADDRESS_!!!', '1'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_ADDRESS');
        return true;
      },
    );
  });

  it('throws INVALID_ADDRESS for EVM address when only fast is configured (no EVM chains)', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const evmAddress = '0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB';
    await assert.rejects(
      () => money.send(evmAddress, '1'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_ADDRESS');
        return true;
      },
    );
  });
});

// ─── money.faucet ─────────────────────────────────────────────────────────────

describe('money.faucet', () => {
  it('calls adapter faucet and returns result with chain, amount, token, txHash', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
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
    const result = await money.faucet('fast');
    assert.equal(result.chain, 'fast');
    assert.equal(result.token, 'SET');
    assert.ok(typeof result.txHash === 'string');
    assert.ok(parseFloat(result.amount) > 0);
    assert.ok(callCount >= 2);
  });

  it('throws for unconfigured chain', async () => {
    await seedConfig(tmpDir);
    await assert.rejects(
      () => money.faucet('solana'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.ok(
          (err as MoneyError).message.includes('solana') || (err as MoneyError).message.includes('not configured'),
        );
        return true;
      },
    );
  });
});

// ─── money.alias ─────────────────────────────────────────────────────────────

describe('money.alias', () => {
  it('GET returns null for unknown alias', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const result = await money.alias('fast', 'NOTEXIST');
    assert.equal(result, null);
  });

  it('SET then GET returns the alias', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    await money.alias('fast', 'MYTOKEN', { address: '0x1234567890123456789012345678901234567890', decimals: 18 });
    const result = await money.alias('fast', 'MYTOKEN');
    assert.ok(result !== null);
    assert.equal(result!.name, 'MYTOKEN');
    assert.equal(result!.address, '0x1234567890123456789012345678901234567890');
    assert.equal(result!.decimals, 18);
  });

  it('throws CHAIN_NOT_CONFIGURED for unconfigured chain', async () => {
    await assert.rejects(
      () => money.alias('bitcoin', 'BTC'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });
});

// ─── money.aliases ─────────────────────────────────────────────────────────────

describe('money.aliases', () => {
  it('returns empty array when no aliases set', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const result = await money.aliases('fast');
    assert.ok(Array.isArray(result));
    // fast chain has no DEFAULT_ALIASES so should be empty
    assert.equal(result.length, 0);
  });

  it('returns aliases after SET', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    await money.alias('fast', 'TKN', { address: '0xaaa' + '0'.repeat(37), decimals: 6 });
    const result = await money.aliases('fast');
    assert.ok(result.some(t => t.name === 'TKN'));
  });

  it('returns empty array for unconfigured chain (no throw)', async () => {
    const result = await money.aliases('unknown');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

// ─── money.history ─────────────────────────────────────────────────────────────

describe('money.history', () => {
  it('returns empty array when no sends have occurred', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const entries = await money.history('fast');
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 0);
  });

  it('returns empty array when called with no chain and no history exists', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const entries = await money.history();
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 0);
  });

  it('returns entries from history.csv after a send', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });
    await money.send(from, '0.001');
    const entries = await money.history();
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].chain, 'fast');
    assert.equal(entries[0].network, 'testnet');
    assert.equal(entries[0].amount, '0.001');
    assert.equal(entries[0].token, 'SET');
    assert.ok(typeof entries[0].txHash === 'string');
    assert.ok(typeof entries[0].ts === 'string');
  });
});

// ─── money.detect ─────────────────────────────────────────────────────────────

describe('money.detect', () => {
  it('detects "fast" from set1... address', () => {
    const result = money.detect('set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc');
    assert.equal(result, 'fast');
  });

  it('returns null for EVM address when no EVM chains are configured', () => {
    // detectChain returns null when no EVM chains are configured (ambiguous/unknown)
    const result = money.detect('0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB');
    assert.equal(result, null);
  });

  it('detects "solana" from base58 address', () => {
    const result = money.detect('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    assert.equal(result, 'solana');
  });

  it('returns null for garbage input', () => {
    assert.equal(money.detect('GARBAGE!@#$%NOT_AN_ADDRESS'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(money.detect(''), null);
  });
});

// ─── money.setup with rpc override ──────────────────────────────────────────

describe('money.setup with rpc override', () => {
  it('stores custom rpc in config.json', async () => {
    const customRpc = 'https://custom-rpc.example.com';
    await money.setup('fast', { rpc: customRpc });
    const configContent = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(configContent) as { chains: Record<string, { rpc: string }> };
    assert.equal(config.chains['fast']?.rpc, customRpc);
  });

  it('re-setup without rpc option preserves existing custom rpc', async () => {
    const customRpc = 'https://custom-rpc.example.com';
    await money.setup('fast', { rpc: customRpc });
    await money.setup('fast');
    const configContent = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(configContent) as { chains: Record<string, { rpc: string }> };
    assert.equal(config.chains['fast']?.rpc, customRpc);
  });

  it('second rpc option overwrites previous custom rpc', async () => {
    await money.setup('fast', { rpc: 'https://first-rpc.example.com' });
    await money.setup('fast', { rpc: 'https://second-rpc.example.com' });
    const configContent = await fs.readFile(path.join(tmpDir, 'config.json'), 'utf-8');
    const config = JSON.parse(configContent) as { chains: Record<string, { rpc: string }> };
    assert.equal(config.chains['fast']?.rpc, 'https://second-rpc.example.com');
  });
});

// ─── money.send — opts.chain and opts.token ──────────────────────────────────

describe('money.send with opts.chain', () => {
  it('explicit opts.chain="fast" works for a fast address', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: 'de0b6b3a7640000000', next_nonce: 1 },
    });
    const to = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
    const result = await money.send(to, 1, { chain: 'fast' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.txHash === 'string');
  });

  it('opts.chain="fast" with an EVM address throws INVALID_ADDRESS', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    const evmAddress = '0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB';
    await assert.rejects(
      () => money.send(evmAddress, 1, { chain: 'fast' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_ADDRESS');
        return true;
      },
    );
  });

  it('opts.token="SET" explicitly is same as default for fast chain', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');
    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: 'de0b6b3a7640000000', next_nonce: 1 },
    });
    const to = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
    const result = await money.send(to, 1, { token: 'SET' });
    assert.equal(result.chain, 'fast');
    assert.equal(result.network, 'testnet');
    assert.ok(typeof result.txHash === 'string');
  });
});

// ─── money.history — chain filter ─────────────────────────────────────────────

describe('money.history with chain filter', () => {
  it('returns only entries matching the given chain', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;

    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });

    // Send on fast chain — writes to history.csv
    await money.send(from, '0.001');

    // fast entries should appear
    const fastEntries = await money.history('fast');
    assert.equal(fastEntries.length, 1);
    assert.equal(fastEntries[0].chain, 'fast');
    assert.equal(fastEntries[0].network, 'testnet');

    // base entries should be empty (nothing sent on base)
    const baseEntries = await money.history('base');
    assert.equal(baseEntries.length, 0);
  });

  it('accepts a number as first arg to limit results across all chains', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;

    globalThis.fetch = standardFastFetch({
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 },
    });

    // Send twice
    await money.send(from, '0.001');
    await money.send(from, '0.002');

    // history(1) should return only 1 entry (the most recent)
    const limited = await money.history(1);
    assert.equal(limited.length, 1);

    // history(10) should return both (limit > count)
    const all = await money.history(10);
    assert.equal(all.length, 2);
  });
});

// ─── history.ts CSV round-trip ────────────────────────────────────────────────

describe('history CSV round-trip', () => {
  it('round-trips an entry with a comma in the token name', async () => {
    // Directly import appendHistory and readHistory via the internal module
    // by writing and reading history through money.send is complex for custom tokens,
    // so we test via the public history file path instead.
    // Write a history.csv manually with a quoted token name, then read it back.
    const csvPath = `${tmpDir}/history.csv`;
    const header = 'ts,chain,network,to,amount,token,txHash';
    const ts = '2024-01-01T00:00:00.000Z';
    const row = `${ts},fast,testnet,set1abc,1.0,"TOKEN,A",0xdeadbeef`;
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(csvPath, `${header}\n${row}\n`, 'utf-8');

    process.env.MONEY_CONFIG_DIR = tmpDir;
    const entries = await money.history();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].token, 'TOKEN,A');
    assert.equal(entries[0].chain, 'fast');
    assert.equal(entries[0].network, 'testnet');
    assert.equal(entries[0].amount, '1.0');
  });
});

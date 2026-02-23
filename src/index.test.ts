/**
 * index.test.ts — Comprehensive unit tests for the money SDK (@fast/money)
 *
 * Test strategy:
 * - Use "fast" chain for most tests (simplest RPC mocking)
 * - Set MONEY_CONFIG_DIR to a unique temp dir per test
 * - Pre-write config with keyfile inside tmpDir for full isolation
 * - Mock globalThis.fetch for all RPC calls
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

/** Build a per-chain config that points keyfiles into tmpDir */
function fastChainConfig(tmpDir: string) {
  return {
    rpc: 'https://proxy.fastset.xyz',
    keyfile: path.join(tmpDir, 'keys', 'fast.json'),
    network: 'testnet',
    defaultToken: 'SET',
  };
}

/**
 * Write config.json to tmpDir so that money.setup() uses our custom keyfile path.
 * money.setup() merges `{ ...existing, rpc: defaults.rpc, network: defaults.network }`,
 * so pre-seeding preserves our keyfile path inside tmpDir.
 */
async function seedConfig(tmpDir: string, chains: Record<string, unknown> = {}) {
  await fs.mkdir(tmpDir, { recursive: true });
  const config = { chains: { fast: fastChainConfig(tmpDir), ...chains } };
  await fs.writeFile(
    path.join(tmpDir, 'config.json'),
    JSON.stringify(config, null, 2),
    { encoding: 'utf-8', mode: 0o600 },
  );
}

/**
 * Create a fetch mock that dispatches based on JSON-RPC method name.
 */
function makeFetchMock(
  handlers: Record<string, unknown>,
): FetchFn {
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

/** Standard mock that handles all three Fast RPCs we need */
function standardFastFetch(overrides: Record<string, unknown> = {}): FetchFn {
  return makeFetchMock({
    proxy_getAccountInfo: { balance: 'de0b6b3a7640000', next_nonce: 0 }, // 1 SET
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
});

afterEach(async () => {
  // Restore fetch
  globalThis.fetch = originalFetch;

  // Restore MONEY_CONFIG_DIR
  if (ORIGINAL_CONFIG_DIR === undefined) {
    delete process.env.MONEY_CONFIG_DIR;
  } else {
    process.env.MONEY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  }

  // Clean up temp dir
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

  it('throws for unknown chain name', async () => {
    await assert.rejects(
      () => money.setup('dogecoin'),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('dogecoin'));
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
    await money.setup('fast'); // creates keyfile

    const chains = await money.chains();
    const fastChain = chains.find(c => c.chain === 'fast');
    assert.ok(fastChain, 'fast chain not found');
    assert.equal(fastChain!.status, 'ready');
    assert.ok(fastChain!.address.startsWith('set1'));
  });

  it('shows "no-key" when keyfile does not exist', async () => {
    // Write config without creating a keyfile
    await seedConfig(tmpDir);
    // Don't call money.setup() — keyfile won't exist

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
    await money.setup('fast'); // creates keyfile + evicts adapter cache

    // Mock fetch to return 1 SET
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
    assert.ok(!Array.isArray(result), 'single chain should return BalanceResult not array');
    const bal = result as { chain: string; address: string; amount: string; token: string };
    assert.equal(bal.chain, 'fast');
    assert.ok(bal.address.startsWith('set1'));
    assert.equal(bal.amount, '1');
    assert.equal(bal.token, 'SET');
  });

  it('throws for unconfigured chain', async () => {
    // Only fast is in config; asking for solana should throw
    await seedConfig(tmpDir);

    await assert.rejects(
      () => money.balance('solana'),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('solana') || err.message.includes('not configured'),
          `unexpected message: ${err.message}`,
        );
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
    const fastBal = (results as Array<{ chain: string; amount: string }>).find(
      r => r.chain === 'fast',
    );
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

    // Use the sender's own address as recipient (self-send for test purposes)
    globalThis.fetch = standardFastFetch({
      // Balance check: 100 SET
      proxy_getAccountInfo: { balance: '56bc75e2d630fffff', next_nonce: 1 }, // ~100 SET
    });

    const result = await money.send(from, '0.001');
    assert.equal(result.chain, 'fast');
    assert.ok(typeof result.txHash === 'string' && result.txHash.length > 0);
    assert.equal(result.fee, '0.01');
  });

  it('throws INSUFFICIENT_BALANCE when balance too low', async () => {
    await seedConfig(tmpDir);
    const setupResult = await money.setup('fast');
    const from = setupResult.address;

    // Return a very low balance (0.001 SET in hex = de0b6b3a7640 = 1e15)
    globalThis.fetch = makeFetchMock({
      proxy_getAccountInfo: { balance: 'e8d4a51000', next_nonce: 0 }, // ~0.000001 SET
    });

    await assert.rejects(
      () => money.send(from, '100'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got ${String(err)}`);
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
        assert.ok(err instanceof MoneyError, `expected MoneyError, got ${String(err)}`);
        assert.equal((err as MoneyError).code, 'INVALID_ADDRESS');
        return true;
      },
    );
  });

  it('throws CHAIN_NOT_CONFIGURED for EVM address when only fast is configured', async () => {
    // Only fast is configured; an EVM address will detect as 'base' but it's not configured
    await seedConfig(tmpDir);
    await money.setup('fast');

    const evmAddress = '0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB';

    await assert.rejects(
      () => money.send(evmAddress, '1'),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got ${String(err)}`);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
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

    // faucet calls proxy_faucetDrip (returns null), then proxy_getAccountInfo for balance
    let callCount = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string };

      if (parsed.method === 'proxy_faucetDrip') {
        return {
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: null }),
        } as Response;
      }
      // proxy_getAccountInfo — return balance after faucet
      return {
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { balance: '21e19e0c9bab2400000', next_nonce: 1 }, // ~10000 SET
        }),
      } as Response;
    }) as FetchFn;

    const result = await money.faucet('fast');
    assert.equal(result.chain, 'fast');
    assert.equal(result.token, 'SET');
    assert.ok(typeof result.txHash === 'string');
    assert.ok(parseFloat(result.amount) > 0, `expected positive amount, got: ${result.amount}`);
    assert.ok(callCount >= 2, `expected at least 2 RPC calls (faucetDrip + getAccountInfo), got ${callCount}`);
  });

  it('throws for unconfigured chain', async () => {
    await seedConfig(tmpDir); // only fast in config

    await assert.rejects(
      () => money.faucet('solana'),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('solana') || err.message.includes('not configured'),
          `unexpected message: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ─── money.history ─────────────────────────────────────────────────────────────

describe('money.history', () => {
  it('returns empty array when adapter has no getHistory (fast adapter)', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');

    // Fast adapter has no getHistory method, so history() skips it
    const entries = await money.history('fast');
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 0);
  });

  it('returns empty array when called with no chain and fast is the only configured chain', async () => {
    await seedConfig(tmpDir);
    await money.setup('fast');

    const entries = await money.history();
    assert.ok(Array.isArray(entries));
    assert.equal(entries.length, 0);
  });
});

// ─── money.detect ─────────────────────────────────────────────────────────────

describe('money.detect', () => {
  it('detects "fast" from set1... address', () => {
    const result = money.detect('set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc');
    assert.equal(result, 'fast');
  });

  it('detects EVM chain from 0x... address', () => {
    const result = money.detect('0x742d35Cc6634C0532925a3b8D4C9b34EcFedBCfB');
    // Returns first EVM chain found in DEFAULT_CHAIN_CONFIGS (base, ethereum, or arbitrum)
    assert.ok(
      result === 'base' || result === 'ethereum' || result === 'arbitrum',
      `expected EVM chain, got: ${result}`,
    );
  });

  it('detects "solana" from base58 address', () => {
    // Valid Solana address (32-44 base58 chars, no 0/O/I/l)
    const result = money.detect('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    assert.equal(result, 'solana');
  });

  it('returns null for garbage input', () => {
    const result = money.detect('GARBAGE!@#$%NOT_AN_ADDRESS');
    assert.equal(result, null);
  });

  it('returns null for empty string', () => {
    const result = money.detect('');
    assert.equal(result, null);
  });
});

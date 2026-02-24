import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEvmAdapter } from './evm.js';
import { MoneyError } from '../errors.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_RPC = 'https://evm-rpc.test.xyz';
const FAKE_EXPLORER = 'https://explorer.test.xyz';
const FAKE_CHAIN = 'base';

/** Minimal ERC-20 token config for tests */
const TEST_TOKENS = {
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
};

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let tmpDir: string;

/** Minimal headers stub for viem compatibility */
const STUB_HEADERS = {
  get: (_name: string) => null,
  has: (_name: string) => false,
  forEach: () => {},
};

/**
 * Build a JSON-RPC Response object for a given result value.
 */
function rpcResponse(result: unknown, id = 1): Response {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  return {
    ok: true,
    status: 200,
    headers: STUB_HEADERS,
    json: async () => ({ jsonrpc: '2.0', id, result }),
    text: async () => body,
    body: null,
    bodyUsed: false,
  } as unknown as Response;
}

/**
 * Build a JSON-RPC error Response.
 */
function rpcErrorResponse(message: string, code = -32000, id = 1): Response {
  const body = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  return {
    ok: true,
    status: 200,
    headers: STUB_HEADERS,
    json: async () => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }),
    text: async () => body,
    body: null,
    bodyUsed: false,
  } as unknown as Response;
}

/**
 * Multi-method fetch mock. Dispatches on the JSON-RPC method in the request body.
 * handlers: Record<method, result> or Record<method, () => Response>
 */
function multiMethodFetch(
  handlers: Record<string, unknown | (() => Response)>,
): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    // viem may batch or send individual requests
    const parsed = JSON.parse(bodyText) as
      | { method: string; id: number }
      | Array<{ method: string; id: number }>;

    if (Array.isArray(parsed)) {
      // Batched request — return an array of responses
      const results = parsed.map((req) => {
        const handler = handlers[req.method];
        if (handler === undefined) {
          return { jsonrpc: '2.0', id: req.id, result: null };
        }
        if (typeof handler === 'function') {
          return { jsonrpc: '2.0', id: req.id, result: null };
        }
        return { jsonrpc: '2.0', id: req.id, result: handler };
      });
      const body = JSON.stringify(results.map((r) => ({ jsonrpc: r.jsonrpc, id: r.id, result: r.result })));
      return {
        ok: true,
        status: 200,
        headers: STUB_HEADERS,
        json: async () => results.map((r) => ({ jsonrpc: r.jsonrpc, id: r.id, result: r.result })),
        text: async () => body,
        body: null,
        bodyUsed: false,
      } as unknown as Response;
    }

    // Single request
    const method = parsed.method;
    const handler = handlers[method];
    if (handler === undefined) {
      return rpcResponse(null);
    }
    if (typeof handler === 'function') {
      return (handler as () => Response)();
    }
    return rpcResponse(handler, parsed.id);
  }) as FetchFn;
}

/**
 * Single-capture fetch: records the last call, returns a fixed result.
 */
function capturingFetch(
  result: unknown,
): { fetch: FetchFn; captured: () => { method: string; params: unknown } } {
  let lastBody: { method: string; params: unknown } = { method: '', params: [] };
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText);
    if (!Array.isArray(parsed)) lastBody = parsed;
    return rpcResponse(result, parsed.id ?? 1);
  }) as FetchFn;
  return { fetch: fn, captured: () => lastBody };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-evm-test-'));
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createEvmAdapter', () => {
  it('returns adapter with correct chain name', () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    assert.equal(adapter.chain, 'base');
  });

  it('addressPattern matches 0x + 40 hex chars', () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    assert.ok(adapter.addressPattern.test('0x742d35Cc6634C0532925a3b8D4C9B1B9b9b9b9b9'));
    assert.ok(adapter.addressPattern.test('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'));
    assert.ok(adapter.addressPattern.test('0x' + 'a'.repeat(40)));
    assert.ok(adapter.addressPattern.test('0x' + '0'.repeat(40)));
    assert.ok(adapter.addressPattern.test('0x' + 'F'.repeat(40)));
  });

  it('addressPattern rejects non-EVM addresses', () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    assert.ok(!adapter.addressPattern.test('set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx'));
    assert.ok(!adapter.addressPattern.test('0x' + 'a'.repeat(39)));  // too short
    assert.ok(!adapter.addressPattern.test('0x' + 'g'.repeat(40)));  // invalid hex char
    assert.ok(!adapter.addressPattern.test('1234567890'));
    assert.ok(!adapter.addressPattern.test(''));
  });
});

describe('setupWallet', () => {
  it('creates keyfile and returns 0x... address (42 chars)', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');
    const result = await adapter.setupWallet(keyfile);

    assert.ok(result.address.startsWith('0x'), `address should start with 0x: ${result.address}`);
    assert.equal(result.address.length, 42, `address should be 42 chars: ${result.address}`);

    const stat = await fs.stat(keyfile);
    assert.ok(stat.isFile());
  });

  it('is idempotent — returns same address on second call', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');

    const r1 = await adapter.setupWallet(keyfile);
    const r2 = await adapter.setupWallet(keyfile);

    assert.equal(r1.address, r2.address);
  });

  it('address matches EVM addressPattern', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm2.json');
    const result = await adapter.setupWallet(keyfile);

    assert.ok(adapter.addressPattern.test(result.address), `${result.address} should match EVM pattern`);
  });
});

describe('getBalance', () => {
  it('fetches native ETH balance via eth_getBalance RPC mock', async () => {
    // 1 ETH = 1e18 wei = 0xde0b6b3a7640000
    const oneEth = '0x0de0b6b3a7640000';

    const { fetch, captured } = capturingFetch(oneEth);
    globalThis.fetch = fetch;

    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const balance = await adapter.getBalance('0x' + 'a'.repeat(40));

    assert.equal(balance.amount, '1', `Expected 1 ETH, got ${balance.amount}`);
    assert.equal(balance.token, 'ETH');
    assert.equal(captured().method, 'eth_getBalance');
  });

  it('fetches ERC-20 balance via eth_call RPC mock (balanceOf)', async () => {
    // 1 USDC = 1_000_000 (6 decimals) = 0xF4240
    // ABI-encoded uint256: exactly 32 bytes = 64 hex chars
    // 64 - 5 (F4240) = 59 leading zeros
    const abiEncoded = '0x' + '0'.repeat(59) + 'f4240'; // 1_000_000 as 32-byte left-padded

    globalThis.fetch = multiMethodFetch({
      eth_call: abiEncoded,
      eth_chainId: '0x2105',  // base mainnet = 8453 = 0x2105
    });

    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const balance = await adapter.getBalance('0x' + 'a'.repeat(40), 'USDC');

    assert.equal(balance.token, 'USDC');
    // 1_000_000 / 1e6 = 1
    assert.equal(balance.amount, '1');
  });

  it('throws for unconfigured token', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    await assert.rejects(
      () => adapter.getBalance('0x' + 'a'.repeat(40), 'UNKNOWN_TOKEN'),
      (err: Error) => {
        assert.ok(err.message.includes('UNKNOWN_TOKEN'), `Expected token name in error: ${err.message}`);
        return true;
      },
    );
  });

  it('fetches balance for raw ERC-20 contract address (calls decimals then balanceOf)', async () => {
    const rawAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    // ABI-encoded uint8 decimals = 6: 32-byte left-padded
    const abiDecimals = '0x' + '0'.repeat(63) + '6';
    // ABI-encoded uint256 balance = 1_000_000 (1 USDC at 6 decimals): 32-byte left-padded
    const abiBalance = '0x' + '0'.repeat(59) + 'f4240';

    let ethCallCount = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; id: number } | Array<{ method: string; id: number }>;
      const reqs = Array.isArray(parsed) ? parsed : [parsed];
      const results = reqs.map(req => {
        if (req.method === 'eth_call') {
          ethCallCount++;
          // First eth_call = decimals(), second = balanceOf()
          const result = ethCallCount === 1 ? abiDecimals : abiBalance;
          return { jsonrpc: '2.0', id: req.id, result };
        }
        return { jsonrpc: '2.0', id: req.id, result: null };
      });
      const body = JSON.stringify(Array.isArray(parsed) ? results : results[0]);
      return {
        ok: true, status: 200, headers: STUB_HEADERS,
        json: async () => (Array.isArray(parsed) ? results : results[0]),
        text: async () => body, body: null, bodyUsed: false,
      } as unknown as Response;
    }) as FetchFn;

    // Empty aliases — raw address must work without registration
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, {});
    const balance = await adapter.getBalance('0x' + 'a'.repeat(40), rawAddress);

    assert.equal(balance.token, rawAddress);
    assert.equal(balance.amount, '1', `expected 1 USDC (1_000_000 / 10^6), got: ${balance.amount}`);
  });
});

describe('send', () => {
  /** Build a full send RPC handler that covers all calls viem makes */
  function buildSendHandlers(txHash = '0xdeadbeef' + '0'.repeat(56)): Record<string, unknown> {
    return {
      eth_chainId: '0x2105',              // base mainnet chain ID
      eth_getTransactionCount: '0x0',    // nonce = 0
      eth_gasPrice: '0x3B9ACA00',        // 1 gwei
      eth_maxPriorityFeePerGas: '0x3B9ACA00',
      eth_estimateGas: '0x5208',         // 21000
      eth_sendRawTransaction: txHash,
      eth_getBlockByNumber: {
        baseFeePerGas: '0x3B9ACA00',
        number: '0x1',
        hash: '0x' + 'b'.repeat(64),
        transactions: [],
        timestamp: '0x60000000',
        gasLimit: '0x1c9c380',
        gasUsed: '0x5208',
        miner: '0x' + '0'.repeat(40),
        parentHash: '0x' + '0'.repeat(64),
        sha3Uncles: '0x' + '0'.repeat(64),
        stateRoot: '0x' + '0'.repeat(64),
        receiptsRoot: '0x' + '0'.repeat(64),
        transactionsRoot: '0x' + '0'.repeat(64),
        logsBloom: '0x' + '0'.repeat(512),
        difficulty: '0x0',
        totalDifficulty: '0x0',
        extraData: '0x',
        mixHash: '0x' + '0'.repeat(64),
        nonce: '0x0000000000000000',
        size: '0x100',
        uncles: [],
      },
      eth_feeHistory: {
        baseFeePerGas: ['0x3B9ACA00', '0x3B9ACA00'],
        gasUsedRatio: [0.5],
        oldestBlock: '0x1',
        reward: [['0x3B9ACA00']],
      },
    };
  }

  it('sends native ETH and returns txHash + explorerUrl', async () => {
    const txHash = '0x' + 'c'.repeat(64);
    globalThis.fetch = multiMethodFetch(buildSendHandlers(txHash));

    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');
    const { address: fromAddr } = await adapter.setupWallet(keyfile);

    const result = await adapter.send({
      from: fromAddr,
      to: '0x' + 'b'.repeat(40),
      amount: '0.001',
      keyfile,
    });

    assert.equal(result.txHash, txHash);
    assert.ok(result.explorerUrl.includes(txHash), `explorerUrl should contain txHash: ${result.explorerUrl}`);
    assert.ok(result.explorerUrl.startsWith(FAKE_EXPLORER), `explorerUrl should start with explorer base: ${result.explorerUrl}`);
    assert.equal(result.fee, '0');
  });

  it('wraps generic RPC errors as MoneyError("TX_FAILED")', async () => {
    // Return an error for eth_sendRawTransaction
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; id: number };
      if (parsed.method === 'eth_sendRawTransaction') {
        return rpcErrorResponse('execution reverted: out of gas', -32000, parsed.id);
      }
      const handlers = buildSendHandlers();
      return rpcResponse(handlers[parsed.method as string] ?? null, parsed.id);
    }) as FetchFn;

    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');
    await adapter.setupWallet(keyfile);

    await assert.rejects(
      () => adapter.send({
        from: '0x' + 'a'.repeat(40),
        to: '0x' + 'b'.repeat(40),
        amount: '0.001',
        keyfile,
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `Expected MoneyError, got: ${err}`);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        return true;
      },
    );
  });

  it('maps "insufficient funds" error to MoneyError("INSUFFICIENT_BALANCE")', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(bodyText) as { method: string; id: number };
      if (parsed.method === 'eth_sendRawTransaction') {
        return rpcErrorResponse('insufficient funds for gas * price + value', -32000, parsed.id);
      }
      const handlers = buildSendHandlers();
      return rpcResponse(handlers[parsed.method as string] ?? null, parsed.id);
    }) as FetchFn;

    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');
    await adapter.setupWallet(keyfile);

    await assert.rejects(
      () => adapter.send({
        from: '0x' + 'a'.repeat(40),
        to: '0x' + 'b'.repeat(40),
        amount: '999999',
        keyfile,
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `Expected MoneyError, got: ${err}`);
        assert.equal((err as MoneyError).code, 'INSUFFICIENT_BALANCE');
        return true;
      },
    );
  });

  it('sends ERC-20 token (USDC) and returns txHash + explorerUrl', async () => {
    const txHash = '0x' + 'd'.repeat(64);
    // viem's writeContract calls similar eth_* methods as sendTransaction
    globalThis.fetch = multiMethodFetch({
      ...buildSendHandlers(txHash),
    });

    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');
    const { address: fromAddr } = await adapter.setupWallet(keyfile);

    const result = await adapter.send({
      from: fromAddr,
      to: '0x' + 'b'.repeat(40),
      amount: '10',
      token: 'USDC',
      keyfile,
    });

    assert.equal(result.txHash, txHash);
    assert.ok(result.explorerUrl.includes(txHash), `explorerUrl should contain txHash`);
    assert.ok(result.explorerUrl.startsWith(FAKE_EXPLORER), `explorerUrl should start with explorer base`);
  });

  it('throws TX_FAILED for unknown token', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'evm.json');
    await adapter.setupWallet(keyfile);

    await assert.rejects(
      () => adapter.send({
        from: '0x' + 'a'.repeat(40),
        to: '0x' + 'b'.repeat(40),
        amount: '10',
        token: 'NOTEXIST',
        keyfile,
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `expected MoneyError, got: ${String(err)}`);
        // The token lookup fails inside withKey, which wraps as TX_FAILED
        assert.ok(
          (err as MoneyError).code === 'TX_FAILED',
          `expected TX_FAILED, got: ${(err as MoneyError).code}`,
        );
        return true;
      },
    );
  });
});

describe('faucet', () => {
  it('throws MoneyError("TX_FAILED") with faucet URL in message', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);

    await assert.rejects(
      () => adapter.faucet('0x' + 'a'.repeat(40)),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `Expected MoneyError, got ${err}`);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        // Should contain a faucet URL in the message
        assert.ok(
          (err as MoneyError).message.includes('http'),
          `Expected faucet URL in message: ${(err as MoneyError).message}`,
        );
        // Should include the chain name
        assert.equal((err as MoneyError).chain, FAKE_CHAIN);
        return true;
      },
    );
  });

  it('includes faucetUrl in error details', async () => {
    const adapter = createEvmAdapter(FAKE_CHAIN, FAKE_RPC, FAKE_EXPLORER, TEST_TOKENS);

    await assert.rejects(
      () => adapter.faucet('0x' + 'a'.repeat(40)),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        const details = (err as MoneyError).details;
        assert.ok(details, 'details should be present');
        assert.ok(typeof details!['faucetUrl'] === 'string', 'faucetUrl should be a string');
        assert.ok(
          (details!['faucetUrl'] as string).startsWith('http'),
          `faucetUrl should be a URL: ${details!['faucetUrl']}`,
        );
        return true;
      },
    );
  });

  it('uses fallback faucet URL for unknown chain', async () => {
    const adapter = createEvmAdapter('unknown-chain', FAKE_RPC, FAKE_EXPLORER, {});

    await assert.rejects(
      () => adapter.faucet('0x' + 'a'.repeat(40)),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        // Should have some fallback URL
        const details = (err as MoneyError).details;
        assert.ok(details?.['faucetUrl'], 'Should have a fallback faucetUrl');
        return true;
      },
    );
  });
});

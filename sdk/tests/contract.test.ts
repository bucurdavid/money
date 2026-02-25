/**
 * contract.test.ts — Unit tests for money.readContract and money.writeContract
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

/** Sample ABI for a view function */
const VIEW_ABI = [
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

/** Sample ABI for a state-changing function */
const WRITE_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
];

const FAKE_CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
const FAKE_TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

/**
 * Build a JSON-RPC mock that handles eth_call (for readContract),
 * eth_sendRawTransaction (for writeContract), and other standard methods.
 */
function makeContractFetchMock(ethCallResult?: string): FetchFn {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(bodyText) as
      | { method: string; id: number }
      | Array<{ method: string; id: number }>;

    const handlers: Record<string, unknown> = {
      eth_chainId: '0x2105',
      eth_getBalance: '0xDE0B6B3A7640000', // 1 ETH
      eth_getTransactionCount: '0x0',
      eth_call: ethCallResult ?? '0x0000000000000000000000000000000000000000000000000000000000000064', // 100
      eth_estimateGas: '0x5208',
      eth_gasPrice: '0x3B9ACA00',
      eth_maxPriorityFeePerGas: '0x3B9ACA00',
      eth_getBlockByNumber: { baseFeePerGas: '0x3B9ACA00', number: '0x1', hash: '0x' + '00'.repeat(32), timestamp: '0x0', transactions: [] },
      eth_sendRawTransaction: FAKE_TX_HASH,
      eth_getTransactionReceipt: { transactionHash: FAKE_TX_HASH, gasUsed: '0x5208', effectiveGasPrice: '0x3B9ACA00', status: '0x1', blockNumber: '0x1', blockHash: '0x' + '00'.repeat(32), logs: [] },
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-contract-test-'));
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

// ─── money.readContract ───────────────────────────────────────────────────────

describe('money.readContract', () => {
  it('reads a view function and returns the result', async () => {
    globalThis.fetch = makeContractFetchMock();
    await money.setup({ chain: 'base' });

    const r = await money.readContract({
      chain: 'base',
      address: FAKE_CONTRACT,
      abi: VIEW_ABI,
      functionName: 'totalSupply',
    });

    assert.equal(r.chain, 'base');
    assert.equal(r.network, 'testnet');
    assert.ok(r.result !== undefined, 'result should be defined');
    assert.equal(r.note, '');
  });

  it('throws CHAIN_NOT_CONFIGURED for unconfigured chain', async () => {
    await assert.rejects(
      () => money.readContract({
        chain: 'base',
        address: FAKE_CONTRACT,
        abi: VIEW_ABI,
        functionName: 'totalSupply',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });

  it('throws UNSUPPORTED_OPERATION on non-EVM chain (fast)', async () => {
    globalThis.fetch = makeContractFetchMock();
    await money.setup({ chain: 'fast' });

    await assert.rejects(
      () => money.readContract({
        chain: 'fast',
        address: FAKE_CONTRACT,
        abi: VIEW_ABI,
        functionName: 'totalSupply',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        assert.ok((err as MoneyError).message.includes('fast'));
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when address is missing', async () => {
    await assert.rejects(
      () => money.readContract({
        chain: 'base',
        address: '',
        abi: VIEW_ABI,
        functionName: 'totalSupply',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when functionName is missing', async () => {
    await assert.rejects(
      () => money.readContract({
        chain: 'base',
        address: FAKE_CONTRACT,
        abi: VIEW_ABI,
        functionName: '',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });
});

// ─── money.writeContract ──────────────────────────────────────────────────────

describe('money.writeContract', () => {
  it('throws UNSUPPORTED_OPERATION on non-EVM chain (fast)', async () => {
    globalThis.fetch = makeContractFetchMock();
    await money.setup({ chain: 'fast' });

    await assert.rejects(
      () => money.writeContract({
        chain: 'fast',
        address: FAKE_CONTRACT,
        abi: WRITE_ABI,
        functionName: 'mint',
        args: ['0x1234567890abcdef1234567890abcdef12345678', 100],
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'UNSUPPORTED_OPERATION');
        return true;
      },
    );
  });

  it('throws INVALID_PARAMS when abi is missing', async () => {
    await assert.rejects(
      () => money.writeContract({
        chain: 'base',
        address: FAKE_CONTRACT,
        abi: null as unknown as unknown[],
        functionName: 'mint',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('throws CHAIN_NOT_CONFIGURED for unconfigured chain', async () => {
    await assert.rejects(
      () => money.writeContract({
        chain: 'base',
        address: FAKE_CONTRACT,
        abi: WRITE_ABI,
        functionName: 'mint',
      }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'CHAIN_NOT_CONFIGURED');
        return true;
      },
    );
  });
});

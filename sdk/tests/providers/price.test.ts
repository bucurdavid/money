/**
 * providers/price.test.ts — Unit tests for money.price() and money.tokenInfo()
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { money, MoneyError } from '../../src/index.js';
import { _resetAdapterCache } from '../../src/registry.js';

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

/** Mock DexScreener search response */
function makeDexScreenerMock(): FetchFn {
  return (async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;

    if (urlStr.includes('dexscreener.com')) {
      const mockPair = {
        chainId: 'ethereum',
        dexId: 'uniswap',
        url: 'https://dexscreener.com/ethereum/0xpair',
        pairAddress: '0xpair',
        baseToken: { address: '0xtoken', name: 'Ethereum', symbol: 'ETH' },
        quoteToken: { address: '0xusdc', name: 'USD Coin', symbol: 'USDC' },
        priceNative: '1',
        priceUsd: '2500.00',
        txns: { h24: { buys: 1000, sells: 800 } },
        volume: { h24: 50000000 },
        priceChange: { h24: 2.5 },
        liquidity: { usd: 10000000, base: 4000, quote: 10000000 },
        fdv: null,
        marketCap: 300000000000,
      };

      const body = JSON.stringify({ pairs: [mockPair] });
      return {
        ok: true,
        status: 200,
        headers: STUB_HEADERS,
        json: async () => ({ pairs: [mockPair] }),
        text: async () => body,
        body: null,
        bodyUsed: false,
      } as unknown as Response;
    }

    // Fallback for non-DexScreener requests
    const body = JSON.stringify({});
    return {
      ok: true,
      status: 200,
      headers: STUB_HEADERS,
      json: async () => ({}),
      text: async () => body,
      body: null,
      bodyUsed: false,
    } as unknown as Response;
  }) as FetchFn;
}

/** Mock DexScreener that returns no results */
function makeEmptyDexScreenerMock(): FetchFn {
  return (async () => {
    const body = JSON.stringify({ pairs: [] });
    return {
      ok: true,
      status: 200,
      headers: STUB_HEADERS,
      json: async () => ({ pairs: [] }),
      text: async () => body,
      body: null,
      bodyUsed: false,
    } as unknown as Response;
  }) as FetchFn;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-price-test-'));
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

// ─── money.price() ───────────────────────────────────────────────────────────

describe('money.price', () => {
  it('throws INVALID_PARAMS when token is missing', async () => {
    await assert.rejects(
      () => money.price({ token: '' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('returns price data from DexScreener mock', async () => {
    globalThis.fetch = makeDexScreenerMock();

    const result = await money.price({ token: 'ETH' });
    assert.equal(result.price, '2500.00');
    assert.equal(result.symbol, 'ETH');
    assert.equal(result.name, 'Ethereum');
    assert.ok(result.volume24h, 'should have volume24h');
    assert.ok(result.liquidity, 'should have liquidity');
    assert.equal(result.note, '');
  });

  it('returns price with chain filter', async () => {
    globalThis.fetch = makeDexScreenerMock();

    const result = await money.price({ token: 'ETH', chain: 'ethereum' });
    assert.equal(result.price, '2500.00');
    assert.equal(result.chain, 'ethereum');
  });

  it('throws TX_FAILED when token is not found', async () => {
    globalThis.fetch = makeEmptyDexScreenerMock();

    await assert.rejects(
      () => money.price({ token: 'NONEXISTENT' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        assert.ok((err as MoneyError).message.includes('Price lookup failed'));
        return true;
      },
    );
  });
});

// ─── money.tokenInfo() ──────────────────────────────────────────────────────

describe('money.tokenInfo', () => {
  it('throws INVALID_PARAMS when token is missing', async () => {
    await assert.rejects(
      () => money.tokenInfo({ token: '' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'INVALID_PARAMS');
        return true;
      },
    );
  });

  it('returns token info from DexScreener mock', async () => {
    globalThis.fetch = makeDexScreenerMock();

    const result = await money.tokenInfo({ token: 'ETH', chain: 'ethereum' });
    assert.equal(result.symbol, 'ETH');
    assert.equal(result.name, 'Ethereum');
    assert.equal(result.address, '0xtoken');
    assert.equal(result.price, '2500.00');
    assert.ok(Array.isArray(result.pairs), 'should have pairs array');
    assert.ok(result.pairs.length > 0, 'should have at least one pair');
    assert.equal(result.pairs[0]!.dex, 'uniswap');
    assert.equal(result.note, '');
  });

  it('throws TX_FAILED when token info is not found', async () => {
    globalThis.fetch = makeEmptyDexScreenerMock();

    await assert.rejects(
      () => money.tokenInfo({ token: 'NONEXISTENT' }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        assert.ok((err as MoneyError).message.includes('Token info lookup failed'));
        return true;
      },
    );
  });
});

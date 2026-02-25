/**
 * providers/registry.test.ts — Unit tests for provider registry
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerSwapProvider,
  registerBridgeProvider,
  registerPriceProvider,
  getSwapProvider,
  getBridgeProvider,
  getPriceProvider,
  listSwapProviders,
  listBridgeProviders,
  listPriceProviders,
  _resetProviders,
} from '../../src/providers/registry.js';
import type { SwapProvider, BridgeProvider, PriceProvider, SwapQuote } from '../../src/providers/types.js';

// ─── Mock providers ───────────────────────────────────────────────────────────

function makeSwapProvider(name: string, chains: string[]): SwapProvider {
  return {
    name,
    chains,
    async quote(): Promise<SwapQuote> {
      return {
        fromToken: '0x1',
        toToken: '0x2',
        fromAmount: '1000000',
        toAmount: '999000',
        fromAmountHuman: '1.0',
        toAmountHuman: '0.999',
        priceImpact: '0.1',
        route: null,
        provider: name,
      };
    },
    async swap(): Promise<{ txHash: string }> {
      return { txHash: '0xabc' };
    },
  };
}

function makeBridgeProvider(name: string, chains: string[], networks?: Array<'testnet' | 'mainnet'>): BridgeProvider {
  const provider: BridgeProvider = {
    name,
    chains,
    async bridge(): Promise<{ txHash: string; orderId: string; estimatedTime?: string }> {
      return { txHash: '0xdef', orderId: 'order1', estimatedTime: '2 min' };
    },
  };
  if (networks) provider.networks = networks;
  return provider;
}

function makePriceProvider(name: string): PriceProvider {
  return {
    name,
    async getPrice(): Promise<{
      price: string;
      symbol: string;
      name: string;
    }> {
      return { price: '100.50', symbol: 'TEST', name: 'Test Token' };
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetProviders();
});

describe('SwapProvider registry', () => {
  it('returns null when no providers registered', () => {
    const provider = getSwapProvider('solana');
    assert.equal(provider, null);
  });

  it('registers and retrieves a swap provider by chain', () => {
    const jp = makeSwapProvider('jupiter', ['solana']);
    registerSwapProvider(jp);

    const found = getSwapProvider('solana');
    assert.ok(found);
    assert.equal(found!.name, 'jupiter');
  });

  it('registers and retrieves a swap provider by name', () => {
    const jp = makeSwapProvider('jupiter', ['solana']);
    const ps = makeSwapProvider('paraswap', ['ethereum', 'base']);
    registerSwapProvider(jp);
    registerSwapProvider(ps);

    const found = getSwapProvider('ethereum', 'paraswap');
    assert.ok(found);
    assert.equal(found!.name, 'paraswap');
  });

  it('returns null for unsupported chain', () => {
    const jp = makeSwapProvider('jupiter', ['solana']);
    registerSwapProvider(jp);

    const found = getSwapProvider('ethereum');
    assert.equal(found, null);
  });

  it('re-registration replaces existing provider with same name', () => {
    const jp1 = makeSwapProvider('jupiter', ['solana']);
    const jp2 = makeSwapProvider('jupiter', ['solana', 'ethereum']);
    registerSwapProvider(jp1);
    registerSwapProvider(jp2);

    const list = listSwapProviders();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.chains, ['solana', 'ethereum']);
  });

  it('lists registered swap providers', () => {
    registerSwapProvider(makeSwapProvider('jupiter', ['solana']));
    registerSwapProvider(makeSwapProvider('paraswap', ['ethereum', 'base']));

    const list = listSwapProviders();
    assert.equal(list.length, 2);
    assert.equal(list[0]!.name, 'jupiter');
    assert.equal(list[1]!.name, 'paraswap');
  });
});

describe('BridgeProvider registry', () => {
  it('returns null when no providers registered', () => {
    const provider = getBridgeProvider();
    assert.equal(provider, null);
  });

  it('registers and retrieves bridge provider by name', () => {
    const db = makeBridgeProvider('debridge', ['ethereum', 'base']);
    registerBridgeProvider(db);

    const found = getBridgeProvider('debridge');
    assert.ok(found);
    assert.equal(found!.name, 'debridge');
  });

  it('returns first bridge provider when no name specified', () => {
    registerBridgeProvider(makeBridgeProvider('debridge', ['ethereum']));
    registerBridgeProvider(makeBridgeProvider('custom-bridge', ['solana']));

    const found = getBridgeProvider();
    assert.ok(found);
    assert.equal(found!.name, 'debridge');
  });

  it('lists bridge providers', () => {
    registerBridgeProvider(makeBridgeProvider('debridge', ['ethereum']));
    const list = listBridgeProviders();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, 'debridge');
  });

  it('selects bridge provider by chain match', () => {
    registerBridgeProvider(makeBridgeProvider('debridge', ['ethereum', 'base']));
    registerBridgeProvider(makeBridgeProvider('omniset', ['fast', 'ethereum', 'arbitrum']));

    const found = getBridgeProvider(undefined, 'fast', 'ethereum');
    assert.ok(found);
    assert.equal(found!.name, 'omniset');
  });

  it('selects bridge provider by network match', () => {
    registerBridgeProvider(makeBridgeProvider('debridge', ['ethereum', 'arbitrum']));
    registerBridgeProvider(makeBridgeProvider('omniset', ['fast', 'ethereum', 'arbitrum'], ['testnet']));

    // DeBridge defaults to mainnet-only; OmniSet declares testnet
    const found = getBridgeProvider(undefined, 'ethereum', 'arbitrum', 'testnet');
    assert.ok(found);
    assert.equal(found!.name, 'omniset');
  });

  it('selects bridge provider matching both chains and network', () => {
    registerBridgeProvider(makeBridgeProvider('debridge', ['ethereum', 'base', 'arbitrum']));
    registerBridgeProvider(makeBridgeProvider('omniset', ['fast', 'ethereum', 'arbitrum'], ['testnet']));

    // fast→ethereum on testnet: only omniset supports 'fast' chain
    const found = getBridgeProvider(undefined, 'fast', 'ethereum', 'testnet');
    assert.ok(found);
    assert.equal(found!.name, 'omniset');
  });

  it('falls back to first provider when no chain/network filter', () => {
    registerBridgeProvider(makeBridgeProvider('debridge', ['ethereum']));
    registerBridgeProvider(makeBridgeProvider('omniset', ['fast', 'ethereum'], ['testnet']));

    const found = getBridgeProvider();
    assert.ok(found);
    assert.equal(found!.name, 'debridge');
  });
});

describe('PriceProvider registry', () => {
  it('returns null when no providers registered', () => {
    const provider = getPriceProvider();
    assert.equal(provider, null);
  });

  it('registers and retrieves price provider by name', () => {
    const ds = makePriceProvider('dexscreener');
    registerPriceProvider(ds);

    const found = getPriceProvider('dexscreener');
    assert.ok(found);
    assert.equal(found!.name, 'dexscreener');
  });

  it('returns first price provider when no name specified', () => {
    registerPriceProvider(makePriceProvider('dexscreener'));
    registerPriceProvider(makePriceProvider('custom-price'));

    const found = getPriceProvider();
    assert.ok(found);
    assert.equal(found!.name, 'dexscreener');
  });

  it('lists price providers', () => {
    registerPriceProvider(makePriceProvider('dexscreener'));
    const list = listPriceProviders();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, 'dexscreener');
  });
});

describe('_resetProviders', () => {
  it('clears all providers', () => {
    registerSwapProvider(makeSwapProvider('j', ['solana']));
    registerBridgeProvider(makeBridgeProvider('d', ['ethereum']));
    registerPriceProvider(makePriceProvider('ds'));

    _resetProviders();

    assert.equal(listSwapProviders().length, 0);
    assert.equal(listBridgeProviders().length, 0);
    assert.equal(listPriceProviders().length, 0);
  });
});

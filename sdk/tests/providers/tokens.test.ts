/**
 * providers/tokens.test.ts — Unit tests for token resolution
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveTokenAddress,
  NATIVE_TOKEN_ADDRESS,
  NATIVE_TOKEN_SYMBOL,
  NATIVE_TOKEN_DECIMALS,
} from '../../src/providers/tokens.js';

describe('resolveTokenAddress', () => {
  it('resolves native ETH on ethereum', () => {
    const result = resolveTokenAddress('ETH', 'ethereum');
    assert.ok(result);
    assert.equal(result!.address, '0x0000000000000000000000000000000000000000');
    assert.equal(result!.decimals, 18);
  });

  it('resolves native SOL on solana', () => {
    const result = resolveTokenAddress('SOL', 'solana');
    assert.ok(result);
    assert.equal(result!.address, 'So11111111111111111111111111111111111111112');
    assert.equal(result!.decimals, 9);
  });

  it('resolves native BNB on bsc', () => {
    const result = resolveTokenAddress('BNB', 'bsc');
    assert.ok(result);
    assert.equal(result!.decimals, 18);
  });

  it('resolves native POL on polygon', () => {
    const result = resolveTokenAddress('POL', 'polygon');
    assert.ok(result);
    assert.equal(result!.decimals, 18);
  });

  it('resolves native AVAX on avalanche', () => {
    const result = resolveTokenAddress('AVAX', 'avalanche');
    assert.ok(result);
    assert.equal(result!.decimals, 18);
  });

  it('resolves native FTM on fantom', () => {
    const result = resolveTokenAddress('FTM', 'fantom');
    assert.ok(result);
    assert.equal(result!.decimals, 18);
  });

  it('resolves USDC on base', () => {
    const result = resolveTokenAddress('USDC', 'base');
    assert.ok(result);
    assert.equal(result!.address, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    assert.equal(result!.decimals, 6);
  });

  it('resolves USDC on solana', () => {
    const result = resolveTokenAddress('USDC', 'solana');
    assert.ok(result);
    assert.equal(result!.address, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    assert.equal(result!.decimals, 6);
  });

  it('resolves USDT on ethereum', () => {
    const result = resolveTokenAddress('USDT', 'ethereum');
    assert.ok(result);
    assert.equal(result!.decimals, 6);
  });

  it('resolves WETH on arbitrum', () => {
    const result = resolveTokenAddress('WETH', 'arbitrum');
    assert.ok(result);
    assert.equal(result!.decimals, 18);
  });

  it('resolves WBTC on ethereum', () => {
    const result = resolveTokenAddress('WBTC', 'ethereum');
    assert.ok(result);
    assert.equal(result!.decimals, 8);
  });

  it('resolves DAI on polygon', () => {
    const result = resolveTokenAddress('DAI', 'polygon');
    assert.ok(result);
    assert.equal(result!.decimals, 18);
  });

  it('is case-insensitive for token symbols', () => {
    const result1 = resolveTokenAddress('usdc', 'ethereum');
    const result2 = resolveTokenAddress('USDC', 'ethereum');
    assert.ok(result1);
    assert.ok(result2);
    assert.equal(result1!.address, result2!.address);
  });

  it('returns null for raw EVM address (pass-through)', () => {
    const result = resolveTokenAddress('0x1234567890abcdef1234567890abcdef12345678', 'ethereum');
    assert.equal(result, null);
  });

  it('returns null for unknown symbol', () => {
    const result = resolveTokenAddress('SHIB', 'ethereum');
    assert.equal(result, null);
  });

  it('returns null for known token on unsupported chain', () => {
    const result = resolveTokenAddress('WETH', 'solana');
    assert.equal(result, null);
  });

  it('resolves native SET on fast chain', () => {
    const result = resolveTokenAddress('SET', 'fast');
    assert.ok(result);
    assert.equal(result!.address, 'fa575e7000000000000000000000000000000000000000000000000000000000');
    assert.equal(result!.decimals, 18);
  });

  it('resolves native SET case-insensitively on fast chain', () => {
    const result = resolveTokenAddress('set', 'fast');
    assert.ok(result);
    assert.equal(result!.address, 'fa575e7000000000000000000000000000000000000000000000000000000000');
    assert.equal(result!.decimals, 18);
  });

  it('resolves WSET on ethereum', () => {
    const result = resolveTokenAddress('WSET', 'ethereum');
    assert.ok(result);
    assert.equal(result!.address, '0x485DdBAa2D62ee70D03B4789912948f3aF7E35B8');
    assert.equal(result!.decimals, 18);
  });

  it('resolves WSET on arbitrum', () => {
    const result = resolveTokenAddress('WSET', 'arbitrum');
    assert.ok(result);
    assert.equal(result!.address, '0xA0431d49B71c6f07603272C6C580560AfF41598E');
    assert.equal(result!.decimals, 18);
  });
});

describe('NATIVE_TOKEN maps', () => {
  it('has entries for all 13 chains', () => {
    const chains = ['ethereum', 'base', 'arbitrum', 'polygon', 'optimism', 'bsc', 'avalanche', 'fantom', 'zksync', 'linea', 'scroll', 'solana', 'fast'];
    for (const chain of chains) {
      assert.ok(NATIVE_TOKEN_SYMBOL[chain], `NATIVE_TOKEN_SYMBOL missing for ${chain}`);
      assert.ok(NATIVE_TOKEN_DECIMALS[chain] !== undefined, `NATIVE_TOKEN_DECIMALS missing for ${chain}`);
    }
  });

  it('has NATIVE_TOKEN_ADDRESS for all 13 chains', () => {
    const chains = ['ethereum', 'base', 'arbitrum', 'polygon', 'optimism', 'bsc', 'avalanche', 'fantom', 'zksync', 'linea', 'scroll', 'solana', 'fast'];
    for (const chain of chains) {
      assert.ok(NATIVE_TOKEN_ADDRESS[chain], `NATIVE_TOKEN_ADDRESS missing for ${chain}`);
    }
  });

  it('all EVM chains use the same native address sentinel', () => {
    const evmChains = ['ethereum', 'base', 'arbitrum', 'polygon', 'optimism', 'bsc', 'avalanche', 'fantom', 'zksync', 'linea', 'scroll'];
    const sentinel = '0x0000000000000000000000000000000000000000';
    for (const chain of evmChains) {
      assert.equal(NATIVE_TOKEN_ADDRESS[chain], sentinel, `${chain} should use EVM native sentinel`);
    }
  });

  it('solana uses WSOL mint as native address', () => {
    assert.equal(NATIVE_TOKEN_ADDRESS['solana'], 'So11111111111111111111111111111111111111112');
  });

  it('fast uses SET token ID hex as native address', () => {
    assert.equal(NATIVE_TOKEN_ADDRESS['fast'], 'fa575e7000000000000000000000000000000000000000000000000000000000');
  });
});

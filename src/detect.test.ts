import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectChain, isValidAddress, getAddressPattern } from './detect.js';

// ─── Realistic test addresses ──────────────────────────────────────────────
// fast: 'set1' + 38+ lowercase alphanumeric chars (real wallet address)
const FAST_ADDR    = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
// evm: '0x' + 40 hex chars
const EVM_ADDR     = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
// solana: base58, 44 chars (like a real pubkey)
const SOLANA_ADDR  = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
// invalid: clearly wrong
const INVALID_ADDR = 'not-a-valid-address';

// ─── detectChain ───────────────────────────────────────────────────────────
describe('detectChain', () => {
  it('returns "fast" for a fast (bech32m) address', () => {
    assert.equal(detectChain(FAST_ADDR, []), 'fast');
  });

  it('returns the configured EVM chain when one EVM chain is configured', () => {
    assert.equal(detectChain(EVM_ADDR, ['base']), 'base');
  });

  it('returns the first EVM_CHAINS-ordered match when multiple EVM chains are configured', () => {
    // EVM_CHAINS order is ['base', 'ethereum', 'arbitrum']
    // So with ['ethereum', 'base'] configured, 'base' comes first in EVM_CHAINS
    assert.equal(detectChain(EVM_ADDR, ['ethereum', 'base']), 'base');
  });

  it('returns "ethereum" when only ethereum is configured', () => {
    assert.equal(detectChain(EVM_ADDR, ['ethereum']), 'ethereum');
  });

  it('falls back to "base" when no EVM chains are configured', () => {
    assert.equal(detectChain(EVM_ADDR, []), 'base');
  });

  it('falls back to "base" when only non-EVM chains are configured', () => {
    assert.equal(detectChain(EVM_ADDR, ['fast', 'solana']), 'base');
  });

  it('returns "solana" for a solana (base58) address', () => {
    assert.equal(detectChain(SOLANA_ADDR, []), 'solana');
  });

  it('returns null for an invalid address', () => {
    assert.equal(detectChain(INVALID_ADDR, ['base', 'ethereum']), null);
  });
});

// ─── isValidAddress ────────────────────────────────────────────────────────
describe('isValidAddress', () => {
  it('returns true for a valid fast address with chain "fast"', () => {
    assert.equal(isValidAddress(FAST_ADDR, 'fast'), true);
  });

  it('returns true for a valid EVM address with chain "base"', () => {
    assert.equal(isValidAddress(EVM_ADDR, 'base'), true);
  });

  it('returns true for a valid EVM address with chain "ethereum" (shared EVM pattern)', () => {
    assert.equal(isValidAddress(EVM_ADDR, 'ethereum'), true);
  });

  it('returns true for a valid EVM address with chain "arbitrum"', () => {
    assert.equal(isValidAddress(EVM_ADDR, 'arbitrum'), true);
  });

  it('returns true for a valid solana address with chain "solana"', () => {
    assert.equal(isValidAddress(SOLANA_ADDR, 'solana'), true);
  });

  it('returns false for an invalid address with chain "fast"', () => {
    assert.equal(isValidAddress(INVALID_ADDR, 'fast'), false);
  });

  it('returns false for a fast address checked against chain "base"', () => {
    assert.equal(isValidAddress(FAST_ADDR, 'base'), false);
  });

  it('returns false for an EVM address checked against chain "solana"', () => {
    assert.equal(isValidAddress(EVM_ADDR, 'solana'), false);
  });

  it('returns false for an unknown chain', () => {
    assert.equal(isValidAddress(EVM_ADDR, 'unknown'), false);
  });
});

// ─── getAddressPattern ─────────────────────────────────────────────────────
describe('getAddressPattern', () => {
  it('returns the fast regex for chain "fast"', () => {
    const pattern = getAddressPattern('fast');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test(FAST_ADDR));
    assert.ok(!pattern.test(EVM_ADDR));
  });

  it('returns the evm regex for chain "base"', () => {
    const pattern = getAddressPattern('base');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test(EVM_ADDR));
    assert.ok(!pattern.test(FAST_ADDR));
  });

  it('returns the evm regex for chain "ethereum"', () => {
    const pattern = getAddressPattern('ethereum');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test(EVM_ADDR));
  });

  it('returns the evm regex for chain "arbitrum"', () => {
    const pattern = getAddressPattern('arbitrum');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test(EVM_ADDR));
  });

  it('"base", "ethereum", and "arbitrum" all return the same pattern instance', () => {
    assert.equal(getAddressPattern('base'), getAddressPattern('ethereum'));
    assert.equal(getAddressPattern('ethereum'), getAddressPattern('arbitrum'));
  });

  it('returns the solana regex for chain "solana"', () => {
    const pattern = getAddressPattern('solana');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test(SOLANA_ADDR));
    assert.ok(!pattern.test(EVM_ADDR));
  });

  it('returns null for an unknown chain', () => {
    assert.equal(getAddressPattern('unknown'), null);
  });
});

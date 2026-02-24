import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MoneyError } from './errors.js';

describe('MoneyError', () => {
  it('has correct name, code, and message', () => {
    const err = new MoneyError('INSUFFICIENT_BALANCE', 'Need 100 SET, have 50');
    assert.equal(err.name, 'MoneyError');
    assert.equal(err.code, 'INSUFFICIENT_BALANCE');
    assert.equal(err.message, 'Need 100 SET, have 50');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof MoneyError);
  });

  it('includes chain and details when provided', () => {
    const err = new MoneyError('TX_FAILED', 'nonce mismatch', {
      chain: 'fast',
      details: { expected: 5, got: 3 },
    });
    assert.equal(err.chain, 'fast');
    assert.deepEqual(err.details, { expected: 5, got: 3 });
  });

  it('chain and details are undefined when not provided', () => {
    const err = new MoneyError('INVALID_ADDRESS', 'bad address');
    assert.equal(err.chain, undefined);
    assert.equal(err.details, undefined);
  });

  it('serializes to JSON correctly', () => {
    const err = new MoneyError('FAUCET_THROTTLED', 'Try again in ~60 seconds.', {
      chain: 'fast',
      details: { retryAfter: 60 },
    });
    const json = err.toJSON();
    assert.deepEqual(json, {
      error: true,
      code: 'FAUCET_THROTTLED',
      message: 'Try again in ~60 seconds.',
      chain: 'fast',
      details: { retryAfter: 60 },
    });
  });

  it('JSON.stringify works via toJSON', () => {
    const err = new MoneyError('CHAIN_NOT_CONFIGURED', 'Run money.setup("base") first.', {
      chain: 'base',
    });
    const parsed = JSON.parse(JSON.stringify(err));
    assert.equal(parsed.error, true);
    assert.equal(parsed.code, 'CHAIN_NOT_CONFIGURED');
    assert.equal(parsed.chain, 'base');
  });

  it('works with all 5 error codes', () => {
    const codes = [
      'INSUFFICIENT_BALANCE',
      'CHAIN_NOT_CONFIGURED',
      'TX_FAILED',
      'FAUCET_THROTTLED',
      'INVALID_ADDRESS',
    ] as const;

    for (const code of codes) {
      const err = new MoneyError(code, `test ${code}`);
      assert.equal(err.code, code);
      assert.equal(err.name, 'MoneyError');
    }
  });
});

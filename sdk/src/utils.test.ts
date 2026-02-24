import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toRaw, toHuman, toHex, fromHex, compareDecimalStrings } from './utils.js';

describe('toRaw', () => {
  it('converts integer amount', () => {
    assert.equal(toRaw('5', 18), 5_000_000_000_000_000_000n);
  });

  it('converts decimal amount', () => {
    assert.equal(toRaw('1.5', 18), 1_500_000_000_000_000_000n);
  });

  it('converts small decimal', () => {
    assert.equal(toRaw('0.001', 18), 1_000_000_000_000_000n);
  });

  it('converts zero', () => {
    assert.equal(toRaw('0', 18), 0n);
  });

  it('works with different decimals', () => {
    assert.equal(toRaw('1.5', 6), 1_500_000n);
  });

  it('truncates excess decimal places', () => {
    assert.equal(toRaw('1.123456789', 6), 1_123_456n);
  });
});

describe('toHuman', () => {
  it('converts round number', () => {
    assert.equal(toHuman(5_000_000_000_000_000_000n, 18), '5');
  });

  it('converts with fraction', () => {
    assert.equal(toHuman(1_500_000_000_000_000_000n, 18), '1.5');
  });

  it('converts zero', () => {
    assert.equal(toHuman(0n, 18), '0');
  });

  it('strips trailing zeros', () => {
    assert.equal(toHuman(1_500_000n, 6), '1.5');
  });

  it('accepts number input', () => {
    assert.equal(toHuman(1_000_000_000, 9), '1');
  });

  it('accepts string input', () => {
    assert.equal(toHuman('1000000', 6), '1');
  });
});

describe('toHex', () => {
  it('converts 1 SET (18 decimals) to hex', () => {
    assert.equal(toHex('1', 18), 'de0b6b3a7640000');
  });

  it('converts 5000 SET to hex', () => {
    assert.equal(toHex('5000', 18), '10f0cf064dd59200000');
  });
});

describe('fromHex', () => {
  it('converts hex to human-readable', () => {
    assert.equal(fromHex('de0b6b3a7640000', 18), '1');
  });

  it('returns "0" for "0"', () => {
    assert.equal(fromHex('0', 18), '0');
  });

  it('returns "0" for empty string', () => {
    assert.equal(fromHex('', 18), '0');
  });

  it('handles large amounts', () => {
    assert.equal(fromHex('10f0cf064dd59200000', 18), '5000');
  });
});

describe('compareDecimalStrings', () => {
  it('returns 0 for equal values', () => {
    assert.equal(compareDecimalStrings('1.5', '1.5'), 0);
  });

  it('returns -1 when a < b', () => {
    assert.equal(compareDecimalStrings('1.5', '2.0'), -1);
  });

  it('returns 1 when a > b (integer vs near-integer)', () => {
    assert.equal(compareDecimalStrings('100', '99.999999999999999999'), 1);
  });

  it('handles 18-decimal precision correctly (returns -1)', () => {
    assert.equal(compareDecimalStrings('0.000000000000000001', '0.000000000000000002'), -1);
  });

  it('returns 1 for large integer vs fraction below it', () => {
    assert.equal(compareDecimalStrings('1000000', '999999.999999999999999999'), 1);
  });

  it('returns 1 when a > b (simple)', () => {
    assert.equal(compareDecimalStrings('2.0', '1.5'), 1);
  });

  it('handles integers without decimal point', () => {
    assert.equal(compareDecimalStrings('10', '10'), 0);
  });
});

/**
 * utils.ts — Shared utilities for money SDK
 *
 * Decimal/amount conversion and path helpers.
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Expand `~` in a path string to the user's home directory.
 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return path.resolve(p);
}

/** Convert human-readable decimal (e.g. "1.5") to raw bigint */
export function toRaw(humanAmount: string, decimals: number): bigint {
  // Normalise scientific notation (e.g. "1e18" → "1000000000000000000")
  // parseFloat handles it; toFixed gives us a decimal string BigInt can parse.
  const normalised = humanAmount.includes('e') || humanAmount.includes('E')
    ? parseFloat(humanAmount).toFixed(decimals)
    : humanAmount;
  const [intPart, fracPart = ''] = normalised.split('.');
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart) * BigInt(10) ** BigInt(decimals) + BigInt(paddedFrac);
}

/** Convert raw amount to human-readable decimal */
export function toHuman(rawAmount: bigint | number | string, decimals: number): string {
  const raw = BigInt(rawAmount);
  const divisor = BigInt(10) ** BigInt(decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  if (fracPart === 0n) return intPart.toString();
  const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${intPart}.${fracStr}`;
}

/** Convert human-readable decimal to hex string (for Fast protocol) */
export function toHex(humanAmount: string, decimals: number): string {
  return toRaw(humanAmount, decimals).toString(16);
}

/** Convert hex string to human-readable decimal (for Fast protocol) */
export function fromHex(hexAmount: string, decimals: number): string {
  if (!hexAmount || hexAmount === '0') return '0';
  return toHuman(BigInt(`0x${hexAmount}`), decimals);
}

/**
 * Compare two decimal number strings without floating-point precision loss.
 * Normalises both strings to the same number of decimal places, converts to
 * BigInt, and compares. Returns -1, 0, or 1.
 */
export function compareDecimalStrings(a: string, b: string): number {
  const [aInt, aFrac = ''] = a.split('.');
  const [bInt, bFrac = ''] = b.split('.');
  const maxFrac = Math.max(aFrac.length, bFrac.length);
  const aRaw = BigInt(aInt + aFrac.padEnd(maxFrac, '0'));
  const bRaw = BigInt(bInt + bFrac.padEnd(maxFrac, '0'));
  if (aRaw < bRaw) return -1;
  if (aRaw > bRaw) return 1;
  return 0;
}

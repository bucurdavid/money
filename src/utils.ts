/**
 * utils.ts — Shared utilities for @fast/money SDK
 *
 * Decimal/amount conversion and path helpers.
 */

import os from 'os';
import path from 'path';

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
  const [intPart, fracPart = ''] = humanAmount.split('.');
  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart) * BigInt(10 ** decimals) + BigInt(paddedFrac);
}

/** Convert raw amount to human-readable decimal */
export function toHuman(rawAmount: bigint | number | string, decimals: number): string {
  const raw = BigInt(rawAmount);
  const divisor = BigInt(10 ** decimals);
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

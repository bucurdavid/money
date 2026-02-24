/**
 * aliases.ts — Internal alias store for @fast/money SDK
 *
 * Named token aliases are stored in ~/.money/aliases.json.
 * Format: { "<configKey>": { "<name>": { address?, mint?, decimals? } } }
 *
 * All functions are internal — not exported from index.ts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './config.js';
import { parseConfigKey } from './defaults.js';
import type { TokenConfig, TokenInfo } from './types.js';

function getAliasesPath(): string {
  return path.join(getConfigDir(), 'aliases.json');
}

async function loadAliases(): Promise<Record<string, Record<string, TokenConfig>>> {
  try {
    const raw = await fs.readFile(getAliasesPath(), 'utf-8');
    return JSON.parse(raw) as Record<string, Record<string, TokenConfig>>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function saveAliases(data: Record<string, Record<string, TokenConfig>>): Promise<void> {
  const aliasesPath = getAliasesPath();
  await fs.mkdir(path.dirname(aliasesPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(aliasesPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

/** GET a single alias. Returns null if not found. */
export async function getAlias(cacheKey: string, name: string): Promise<TokenInfo | null> {
  const all = await loadAliases();
  const tc = all[cacheKey]?.[name];
  if (!tc) return null;
  const { chain, network } = parseConfigKey(cacheKey);
  return {
    chain,
    network,
    name,
    ...(tc.address ? { address: tc.address } : {}),
    ...(tc.mint ? { mint: tc.mint } : {}),
    decimals: tc.decimals ?? 6,
  };
}

/** SET a single alias. Creates or overwrites. */
export async function setAlias(cacheKey: string, name: string, config: TokenConfig): Promise<void> {
  const all = await loadAliases();
  all[cacheKey] = { ...(all[cacheKey] ?? {}), [name]: config };
  await saveAliases(all);
}

/** List all aliases for a config key. */
export async function getAliases(cacheKey: string): Promise<TokenInfo[]> {
  const all = await loadAliases();
  const entries = all[cacheKey] ?? {};
  const { chain, network } = parseConfigKey(cacheKey);
  return Object.entries(entries).map(([name, tc]) => ({
    chain,
    network,
    name,
    ...(tc.address ? { address: tc.address } : {}),
    ...(tc.mint ? { mint: tc.mint } : {}),
    decimals: tc.decimals ?? 6,
  }));
}

/**
 * Seed aliases for a config key from a defaults map.
 * Only writes entries that don't already exist (idempotent).
 */
export async function seedAliases(
  cacheKey: string,
  defaults: Record<string, TokenConfig> | undefined,
): Promise<void> {
  if (!defaults || Object.keys(defaults).length === 0) return;
  const all = await loadAliases();
  const existing = all[cacheKey] ?? {};
  let changed = false;
  for (const [name, config] of Object.entries(defaults)) {
    if (!existing[name]) {
      existing[name] = config;
      changed = true;
    }
  }
  if (changed) {
    all[cacheKey] = existing;
    await saveAliases(all);
  }
}

/** Get EVM aliases for a config key — used by registry.ts to build the adapter's token map. */
export async function getEvmAliases(
  cacheKey: string,
): Promise<Record<string, { address: string; decimals: number }>> {
  const all = await loadAliases();
  const entries = all[cacheKey] ?? {};
  const result: Record<string, { address: string; decimals: number }> = {};
  for (const [name, tc] of Object.entries(entries)) {
    if (tc.address) result[name] = { address: tc.address, decimals: tc.decimals ?? 6 };
  }
  return result;
}

/** Get Solana aliases for a config key — used by registry.ts to build the adapter's token map. */
export async function getSolanaAliases(
  cacheKey: string,
): Promise<Record<string, { mint: string; decimals: number }>> {
  const all = await loadAliases();
  const entries = all[cacheKey] ?? {};
  const result: Record<string, { mint: string; decimals: number }> = {};
  for (const [name, tc] of Object.entries(entries)) {
    if (tc.mint) result[name] = { mint: tc.mint, decimals: tc.decimals ?? 6 };
  }
  return result;
}

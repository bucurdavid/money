/**
 * history.ts — Internal send history store for @fast/money SDK
 *
 * Append-only CSV at ~/.money/history.csv
 * Format: ts,chain,to,amount,token,txHash
 * All functions are internal — not exported from index.ts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './config.js';
import { parseConfigKey } from './defaults.js';
import type { HistoryEntry } from './types.js';

function getHistoryPath(): string {
  return path.join(getConfigDir(), 'history.csv');
}

const CSV_HEADER = 'ts,chain,network,to,amount,token,txHash';

function entryToRow(e: HistoryEntry): string {
  const fields = [e.ts, e.chain, e.network, e.to, e.amount, e.token, e.txHash];
  const escape = (f: string): string => {
    if (f.includes('"') || f.includes(',') || f.includes('\n')) {
      return `"${f.replace(/"/g, '""')}"`;
    }
    return f;
  };
  return fields.map(escape).join(',');
}

function rowToEntry(row: string): HistoryEntry | null {
  // RFC 4180 CSV parse with "" unescape support
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < row.length) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  parts.push(current);

  if (parts.length === 7) {
    // New format: ts,chain,network,to,amount,token,txHash
    const [ts, chain, network, to, amount, token, txHash] = parts;
    if (!ts || !chain || !network || !to || !amount || !token || !txHash) return null;
    return { ts, chain, network: network as 'testnet' | 'mainnet', to, amount, token, txHash };
  }

  if (parts.length === 6) {
    // Old format: ts,chainKey,to,amount,token,txHash — migrate on read
    const [ts, chainKey, to, amount, token, txHash] = parts;
    if (!ts || !chainKey || !to || !amount || !token || !txHash) return null;
    const { chain, network } = parseConfigKey(chainKey);
    return { ts, chain, network, to, amount, token, txHash };
  }

  return null;
}

/** Append a single send to history.csv. Creates file with header if missing. */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const histPath = getHistoryPath();
  await fs.mkdir(path.dirname(histPath), { recursive: true, mode: 0o700 });

  // Open for append, create with 0o600 if missing — atomic, no TOCTOU
  const fh = await fs.open(histPath, 'a', 0o600);
  try {
    const { size } = await fh.stat();
    if (size === 0) {
      await fh.write(CSV_HEADER + '\n');
    }
    await fh.write(entryToRow(entry) + '\n');
  } finally {
    await fh.close();
  }
}

/**
 * Read history from CSV, newest-first.
 * @param chain - optional config key filter (e.g. "fast", "base:mainnet")
 * @param limit - max entries to return
 */
export async function readHistory(chain?: string, limit?: number): Promise<HistoryEntry[]> {
  const histPath = getHistoryPath();
  let raw: string;
  try {
    raw = await fs.readFile(histPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const lines = raw.split('\n').filter(l => l.trim() && l.trim() !== CSV_HEADER);
  const entries: HistoryEntry[] = [];

  for (const line of lines) {
    const entry = rowToEntry(line);
    if (!entry) continue;
    if (chain && entry.chain !== chain) continue;
    entries.push(entry);
  }

  // Newest first — guard against NaN from malformed timestamps
  entries.sort((a, b) => {
    const ta = Date.parse(a.ts);
    const tb = Date.parse(b.ts);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });

  if (limit !== undefined) return entries.slice(0, limit);
  return entries;
}

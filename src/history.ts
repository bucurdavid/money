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
import type { HistoryEntry } from './types.js';

function getHistoryPath(): string {
  return path.join(getConfigDir(), 'history.csv');
}

const CSV_HEADER = 'ts,chain,to,amount,token,txHash';

function entryToRow(e: HistoryEntry): string {
  // Escape commas in fields by wrapping in quotes if needed
  const fields = [e.ts, e.chain, e.to, e.amount, e.token, e.txHash];
  return fields.map(f => (f.includes(',') ? `"${f}"` : f)).join(',');
}

function rowToEntry(row: string): HistoryEntry | null {
  // Simple CSV parse — fields may be quoted
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of row) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  if (parts.length < 6) return null;
  const [ts, chain, to, amount, token, txHash] = parts;
  if (!ts || !chain || !to || !amount || !token || !txHash) return null;
  return { ts, chain, to, amount, token, txHash };
}

/** Append a single send to history.csv. Creates file with header if missing. */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const histPath = getHistoryPath();
  await fs.mkdir(path.dirname(histPath), { recursive: true, mode: 0o700 });

  // Check if file exists; if not, write header first
  let fileExists = true;
  try {
    await fs.access(histPath);
  } catch {
    fileExists = false;
  }

  if (!fileExists) {
    await fs.writeFile(histPath, CSV_HEADER + '\n', { encoding: 'utf-8', mode: 0o600 });
  }

  await fs.appendFile(histPath, entryToRow(entry) + '\n', 'utf-8');
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

  const lines = raw.split('\n').filter(l => l.trim() && l !== CSV_HEADER);
  const entries: HistoryEntry[] = [];

  for (const line of lines) {
    const entry = rowToEntry(line);
    if (!entry) continue;
    if (chain && entry.chain !== chain) continue;
    entries.push(entry);
  }

  // Newest first
  entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  if (limit !== undefined) return entries.slice(0, limit);
  return entries;
}

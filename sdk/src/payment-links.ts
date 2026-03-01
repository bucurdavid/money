/**
 * payment-links.ts — Universal payment link generation and local CSV tracking.
 *
 * Append-only CSV at ~/.money/payment-links.csv
 * Format: ts,payment_id,direction,chain,network,receiver,amount,token,memo,url,txHash
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './config.js';

export interface PaymentLinkEntry {
  ts: string;
  payment_id: string;
  direction: 'created' | 'paid';
  chain: string;
  network: string;
  receiver: string;
  amount: string;
  token: string;
  memo: string;
  url: string;
  txHash: string;
}

const CSV_HEADER = 'ts,payment_id,direction,chain,network,receiver,amount,token,memo,url,txHash';

function getPaymentLinksPath(): string {
  return path.join(getConfigDir(), 'payment-links.csv');
}

/** Generate a unique payment ID. */
export function generatePaymentId(): string {
  return 'pay_' + randomBytes(16).toString('hex');
}

/** Build a payment URL with proper encoding. */
export function buildPaymentUrl(
  params: {
    receiver: string;
    amount: string;
    chain: string;
    token?: string;
    network?: string;
    memo?: string;
  },
  baseUrl: string,
): string {
  const searchParams = new URLSearchParams();
  searchParams.set('receiver', params.receiver);
  searchParams.set('amount', params.amount);
  searchParams.set('chain', params.chain);
  if (params.token) {
    searchParams.set('token', params.token);
  }
  if (params.network) {
    searchParams.set('network', params.network);
  }
  if (params.memo) {
    searchParams.set('memo', params.memo);
  }
  return `${baseUrl}/pay?${searchParams.toString()}`;
}

/** Generate a payment request markdown document. */
export function generatePaymentMarkdown(
  params: {
    payment_id: string;
    receiver: string;
    amount: string;
    chain: string;
    token: string;
    network: string;
    memo?: string;
    expires_at: string;
    created_at: string;
  },
  baseUrl: string,
): string {
  const tick = '`';
  const memoLine = params.memo ? ` Memo: "${params.memo}"` : '';
  const networkNote = params.network === 'testnet'
    ? 'Testnet — no real money.'
    : 'MAINNET — real funds.';

  return `---
type: payment_request
version: "2.0"
payment_id: "${params.payment_id}"
chain: "${params.chain}"
network: "${params.network}"
receiver: "${params.receiver}"
amount: "${params.amount}"
token: "${params.token}"
memo: "${params.memo ?? ''}"
expires_at: "${params.expires_at}"
created_at: "${params.created_at}"
skill: "${baseUrl}/skill.md"
---

# Payment Request — ${params.amount} ${params.token} on ${params.chain}

Send **${params.amount} ${params.token}** to ${tick}${params.receiver}${tick} on **${params.chain}** (${params.network}).${memoLine}

## Setup

If you don't have the money skill installed:

${tick + tick + tick}bash
mkdir -p ~/.money
curl -sL ${baseUrl}/skill.md -o ~/.money/SKILL.md
curl -sL ${baseUrl}/money.bundle.js -o ~/.money/money.bundle.js
curl -sL ${baseUrl}/money.bundle.js.sha256 -o /tmp/money.sha256
(cd ~/.money && shasum -a 256 -c /tmp/money.sha256) && rm -f /tmp/money.sha256
${tick + tick + tick}

## Pay

${tick + tick + tick}js
const { money } = await import(${tick}${String.raw`${process.env.HOME}`}/.money/money.bundle.js${tick});
await money.setup({ chain: "${params.chain}", network: "${params.network}" });
await money.send({ to: "${params.receiver}", amount: ${params.amount}, chain: "${params.chain}", token: "${params.token}", network: "${params.network}", payment_id: "${params.payment_id}" });
${tick + tick + tick}

> ${networkNote} Expires: ${params.expires_at}
`;
}

/** RFC 4180 CSV field escaping. */
function escapeField(f: string): string {
  if (f.includes('"') || f.includes(',') || f.includes('\n')) {
    return `"${f.replace(/"/g, '""')}"`;
  }
  return f;
}

/** Convert a PaymentLinkEntry to a CSV row. */
function entryToRow(e: PaymentLinkEntry): string {
  const fields = [
    e.ts,
    e.payment_id,
    e.direction,
    e.chain,
    e.network,
    e.receiver,
    e.amount,
    e.token,
    e.memo,
    e.url,
    e.txHash,
  ];
  return fields.map(escapeField).join(',');
}

/** RFC 4180 CSV parsing — handles quoted fields with "" escaping. */
function parseRow(row: string): string[] {
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
  return parts;
}

/** Split raw CSV text into logical rows, respecting quoted fields with embedded newlines. */
function splitCsvRows(raw: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      rows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    rows.push(current);
  }
  return rows;
}

/** Convert a CSV row to a PaymentLinkEntry, or null if invalid. */
function rowToEntry(row: string): PaymentLinkEntry | null {
  const parts = parseRow(row);
  if (parts.length !== 11) return null;
  const [ts, payment_id, direction, chain, network, receiver, amount, token, memo, url, txHash] = parts;
  if (!ts || !payment_id || !direction) return null;
  if (direction !== 'created' && direction !== 'paid') return null;
  return {
    ts: ts ?? '',
    payment_id: payment_id ?? '',
    direction,
    chain: chain ?? '',
    network: network ?? '',
    receiver: receiver ?? '',
    amount: amount ?? '',
    token: token ?? '',
    memo: memo ?? '',
    url: url ?? '',
    txHash: txHash ?? '',
  };
}

/** Append a single payment link entry to payment-links.csv. Creates file with header if missing. */
export async function appendPaymentLink(entry: PaymentLinkEntry): Promise<void> {
  const filePath = getPaymentLinksPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });

  const fh = await fs.open(filePath, 'a', 0o600);
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

/** Read payment links from CSV, newest-first, with optional filtering. */
export async function readPaymentLinks(opts?: {
  payment_id?: string;
  direction?: string;
  chain?: string;
  limit?: number;
}): Promise<PaymentLinkEntry[]> {
  const filePath = getPaymentLinksPath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const lines = splitCsvRows(raw).filter((l) => l.trim() && l.trim() !== CSV_HEADER);
  const entries: PaymentLinkEntry[] = [];

  for (const line of lines) {
    const entry = rowToEntry(line);
    if (!entry) continue;
    if (opts?.payment_id && entry.payment_id !== opts.payment_id) continue;
    if (opts?.direction && entry.direction !== opts.direction) continue;
    if (opts?.chain && entry.chain !== opts.chain) continue;
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

  if (opts?.limit !== undefined) return entries.slice(0, opts.limit);
  return entries;
}

/** Find the first 'paid' entry for a given payment_id, or null if not found. */
export async function findPaidLink(payment_id: string): Promise<PaymentLinkEntry | null> {
  const entries = await readPaymentLinks({ payment_id });
  return entries.find((e) => e.direction === 'paid') ?? null;
}

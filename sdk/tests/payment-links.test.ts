import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generatePaymentId,
  buildPaymentUrl,
  generatePaymentMarkdown,
  appendPaymentLink,
  readPaymentLinks,
  findPaidLink,
} from '../src/payment-links.js';
import type { PaymentLinkEntry } from '../src/payment-links.js';

// ─── Test addresses ──────────────────────────────────────────────────────────

const FAST_ADDR = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
const EVM_ADDR = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
const SOLANA_ADDR = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const BASE_URL = 'https://money.example.com';

// ─── Temp config dir ─────────────────────────────────────────────────────────

let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-paylink-test-'));
  process.env.MONEY_CONFIG_DIR = tmpDir;
});

afterEach(async () => {
  if (ORIGINAL_CONFIG_DIR === undefined) {
    delete process.env.MONEY_CONFIG_DIR;
  } else {
    process.env.MONEY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function sampleEntry(overrides?: Partial<PaymentLinkEntry>): PaymentLinkEntry {
  return {
    ts: '2026-03-01T12:00:00.000Z',
    payment_id: 'pay_abc123def456abc123def456abc123de',
    direction: 'created',
    chain: 'fast',
    network: 'testnet',
    receiver: FAST_ADDR,
    amount: '10',
    token: 'SET',
    memo: '',
    url: `${BASE_URL}/pay?receiver=${FAST_ADDR}&amount=10&chain=fast`,
    txHash: '',
    ...overrides,
  };
}

// ─── generatePaymentId ──────────────────────────────────────────────────────

describe('generatePaymentId', () => {
  it('returns a string starting with pay_', () => {
    const id = generatePaymentId();
    assert.ok(id.startsWith('pay_'));
  });

  it('has correct length (36 chars: 4 prefix + 32 hex)', () => {
    const id = generatePaymentId();
    assert.equal(id.length, 36);
  });

  it('contains only valid hex chars after prefix', () => {
    const id = generatePaymentId();
    assert.match(id.slice(4), /^[0-9a-f]{32}$/);
  });

  it('generates unique IDs on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generatePaymentId());
    }
    assert.equal(ids.size, 100);
  });

  it('returns a string, not a Promise', () => {
    const result = generatePaymentId();
    assert.equal(typeof result, 'string');
  });
});

// ─── buildPaymentUrl ────────────────────────────────────────────────────────

describe('buildPaymentUrl', () => {
  it('includes required params: receiver, amount, chain', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('receiver'), FAST_ADDR);
    assert.equal(parsed.searchParams.get('amount'), '10');
    assert.equal(parsed.searchParams.get('chain'), 'fast');
  });

  it('includes token when provided', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast', token: 'SET' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('token'), 'SET');
  });

  it('includes network when provided', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast', network: 'mainnet' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('network'), 'mainnet');
  });

  it('includes memo when provided', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast', memo: 'coffee' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('memo'), 'coffee');
  });

  it('omits token when not provided', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('token'), null);
  });

  it('omits network when not provided', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('network'), null);
  });

  it('omits memo when not provided', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('memo'), null);
  });

  it('URL-encodes special characters in memo', () => {
    const memo = 'hello world & friends=true';
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast', memo }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('memo'), memo);
  });

  it('uses the provided baseUrl', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast' }, 'https://custom.host.com');
    assert.ok(url.startsWith('https://custom.host.com'));
  });

  it('path is /pay', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '10', chain: 'fast' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/pay');
  });

  it('works with Fast chain address', () => {
    const url = buildPaymentUrl({ receiver: FAST_ADDR, amount: '5', chain: 'fast' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('receiver'), FAST_ADDR);
    assert.equal(parsed.searchParams.get('chain'), 'fast');
  });

  it('works with EVM chain address', () => {
    const url = buildPaymentUrl({ receiver: EVM_ADDR, amount: '5', chain: 'base' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('receiver'), EVM_ADDR);
    assert.equal(parsed.searchParams.get('chain'), 'base');
  });

  it('works with Solana chain address', () => {
    const url = buildPaymentUrl({ receiver: SOLANA_ADDR, amount: '5', chain: 'solana' }, BASE_URL);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('receiver'), SOLANA_ADDR);
    assert.equal(parsed.searchParams.get('chain'), 'solana');
  });
});

// ─── generatePaymentMarkdown ────────────────────────────────────────────────

describe('generatePaymentMarkdown', () => {
  const baseParams = {
    payment_id: 'pay_test1234567890abcdef12345678',
    receiver: FAST_ADDR,
    amount: '10',
    chain: 'fast',
    token: 'SET',
    network: 'testnet',
    expires_at: '2026-03-02T12:00:00.000Z',
    created_at: '2026-03-01T12:00:00.000Z',
  };

  it('contains YAML frontmatter delimiters', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.startsWith('---\n'));
    // Find second occurrence of ---
    const secondIdx = md.indexOf('---', 4);
    assert.ok(secondIdx > 0);
  });

  it('frontmatter contains payment_id', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`payment_id: "${baseParams.payment_id}"`));
  });

  it('frontmatter contains chain', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('chain: "fast"'));
  });

  it('frontmatter contains receiver', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`receiver: "${FAST_ADDR}"`));
  });

  it('frontmatter contains amount', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('amount: "10"'));
  });

  it('frontmatter contains token', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('token: "SET"'));
  });

  it('frontmatter contains network', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('network: "testnet"'));
  });

  it('frontmatter contains expires_at', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`expires_at: "${baseParams.expires_at}"`));
  });

  it('frontmatter contains created_at', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`created_at: "${baseParams.created_at}"`));
  });

  it('frontmatter type is payment_request', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('type: payment_request'));
  });

  it('frontmatter contains skill URL with baseUrl', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`skill: "${BASE_URL}/skill.md"`));
  });

  it('body includes receiver address', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    // After the second --- (body section)
    const body = md.split('---').slice(2).join('---');
    assert.ok(body.includes(FAST_ADDR));
  });

  it('body includes money.send() with correct params', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`to: "${FAST_ADDR}"`));
    assert.ok(md.includes('amount: 10'));
    assert.ok(md.includes('chain: "fast"'));
  });

  it('body includes money.setup() with correct chain', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('money.setup({ chain: "fast"'));
  });

  it('body includes install instructions with baseUrl', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`curl -sL ${BASE_URL}/skill.md`));
    assert.ok(md.includes(`curl -sL ${BASE_URL}/money.bundle.js`));
  });

  it('body includes payment_id in send() call', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes(`payment_id: "${baseParams.payment_id}"`));
  });

  it('includes memo when provided', () => {
    const md = generatePaymentMarkdown({ ...baseParams, memo: 'coffee' }, BASE_URL);
    assert.ok(md.includes('coffee'));
  });

  it('handles empty memo gracefully', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('memo: ""'));
  });

  it('works for EVM chain', () => {
    const md = generatePaymentMarkdown(
      { ...baseParams, chain: 'base', receiver: EVM_ADDR, token: 'ETH' },
      BASE_URL,
    );
    assert.ok(md.includes('chain: "base"'));
    assert.ok(md.includes(`receiver: "${EVM_ADDR}"`));
    assert.ok(md.includes('token: "ETH"'));
  });

  it('works for Solana chain', () => {
    const md = generatePaymentMarkdown(
      { ...baseParams, chain: 'solana', receiver: SOLANA_ADDR, token: 'SOL' },
      BASE_URL,
    );
    assert.ok(md.includes('chain: "solana"'));
    assert.ok(md.includes(`receiver: "${SOLANA_ADDR}"`));
    assert.ok(md.includes('token: "SOL"'));
  });

  it('testnet shows testnet disclaimer', () => {
    const md = generatePaymentMarkdown(baseParams, BASE_URL);
    assert.ok(md.includes('Testnet'));
    assert.ok(md.includes('no real money'));
  });

  it('mainnet shows mainnet warning', () => {
    const md = generatePaymentMarkdown({ ...baseParams, network: 'mainnet' }, BASE_URL);
    assert.ok(md.includes('MAINNET'));
    assert.ok(md.includes('real funds'));
  });
});

// ─── appendPaymentLink ──────────────────────────────────────────────────────

describe('appendPaymentLink', () => {
  it('creates CSV file if it does not exist', async () => {
    await appendPaymentLink(sampleEntry());
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const stat = await fs.stat(filePath);
    assert.ok(stat.isFile());
  });

  it('writes header as first line', async () => {
    await appendPaymentLink(sampleEntry());
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    assert.equal(lines[0], 'ts,payment_id,direction,chain,network,receiver,amount,token,memo,url,txHash');
  });

  it('appends entry after header', async () => {
    await appendPaymentLink(sampleEntry());
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 2); // header + 1 entry
  });

  it('appends multiple entries', async () => {
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_aaa' }));
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_bbb' }));
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_ccc' }));
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 4); // header + 3 entries
  });

  it('correctly serializes all fields', async () => {
    const entry = sampleEntry();
    await appendPaymentLink(entry);
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const row = lines[1]!;
    // Simple CSV — no special chars in this entry, so fields are comma-separated
    assert.ok(row.includes(entry.ts));
    assert.ok(row.includes(entry.payment_id));
    assert.ok(row.includes(entry.direction));
    assert.ok(row.includes(entry.chain));
    assert.ok(row.includes(entry.network));
    assert.ok(row.includes(entry.receiver));
    assert.ok(row.includes(entry.amount));
    assert.ok(row.includes(entry.token));
  });

  it('escapes fields containing commas', async () => {
    const entry = sampleEntry({ memo: 'hello, world' });
    await appendPaymentLink(entry);
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    // Memo with comma should be quoted
    assert.ok(content.includes('"hello, world"'));
  });

  it('escapes fields containing double quotes', async () => {
    const entry = sampleEntry({ memo: 'say "hello"' });
    await appendPaymentLink(entry);
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    // Quotes should be escaped as ""
    assert.ok(content.includes('"say ""hello"""'));
  });

  it('escapes fields containing newlines', async () => {
    const entry = sampleEntry({ memo: 'line1\nline2' });
    await appendPaymentLink(entry);
    const filePath = path.join(tmpDir, 'payment-links.csv');
    const content = await fs.readFile(filePath, 'utf-8');
    assert.ok(content.includes('"line1\nline2"'));
  });
});

// ─── readPaymentLinks ───────────────────────────────────────────────────────

describe('readPaymentLinks', () => {
  it('returns empty array when file does not exist', async () => {
    const entries = await readPaymentLinks();
    assert.deepEqual(entries, []);
  });

  it('returns entries newest-first', async () => {
    await appendPaymentLink(sampleEntry({ ts: '2026-03-01T10:00:00.000Z', payment_id: 'pay_first' }));
    await appendPaymentLink(sampleEntry({ ts: '2026-03-01T12:00:00.000Z', payment_id: 'pay_third' }));
    await appendPaymentLink(sampleEntry({ ts: '2026-03-01T11:00:00.000Z', payment_id: 'pay_second' }));
    const entries = await readPaymentLinks();
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.payment_id, 'pay_third');
    assert.equal(entries[1]!.payment_id, 'pay_second');
    assert.equal(entries[2]!.payment_id, 'pay_first');
  });

  it('filters by payment_id', async () => {
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_aaa' }));
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_bbb' }));
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_ccc' }));
    const entries = await readPaymentLinks({ payment_id: 'pay_bbb' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.payment_id, 'pay_bbb');
  });

  it('filters by direction', async () => {
    await appendPaymentLink(sampleEntry({ direction: 'created', payment_id: 'pay_aaa' }));
    await appendPaymentLink(sampleEntry({ direction: 'paid', payment_id: 'pay_bbb', txHash: '0xabc' }));
    await appendPaymentLink(sampleEntry({ direction: 'created', payment_id: 'pay_ccc' }));
    const entries = await readPaymentLinks({ direction: 'paid' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.payment_id, 'pay_bbb');
  });

  it('filters by chain', async () => {
    await appendPaymentLink(sampleEntry({ chain: 'fast', payment_id: 'pay_aaa' }));
    await appendPaymentLink(sampleEntry({ chain: 'base', payment_id: 'pay_bbb', receiver: EVM_ADDR }));
    await appendPaymentLink(sampleEntry({ chain: 'fast', payment_id: 'pay_ccc' }));
    const entries = await readPaymentLinks({ chain: 'base' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.payment_id, 'pay_bbb');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendPaymentLink(sampleEntry({
        payment_id: `pay_item${i}`,
        ts: `2026-03-01T1${i}:00:00.000Z`,
      }));
    }
    const entries = await readPaymentLinks({ limit: 2 });
    assert.equal(entries.length, 2);
  });

  it('handles empty CSV (header only)', async () => {
    const filePath = path.join(tmpDir, 'payment-links.csv');
    await fs.writeFile(filePath, 'ts,payment_id,direction,chain,network,receiver,amount,token,memo,url,txHash\n');
    const entries = await readPaymentLinks();
    assert.deepEqual(entries, []);
  });

  it('round-trips entries with special characters in memo', async () => {
    const memo = 'hello, "world" & friends\nnewline';
    await appendPaymentLink(sampleEntry({ memo }));
    const entries = await readPaymentLinks();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.memo, memo);
  });

  it('combines multiple filters', async () => {
    await appendPaymentLink(sampleEntry({ chain: 'fast', direction: 'created', payment_id: 'pay_a' }));
    await appendPaymentLink(sampleEntry({ chain: 'fast', direction: 'paid', payment_id: 'pay_b', txHash: '0x1' }));
    await appendPaymentLink(sampleEntry({ chain: 'base', direction: 'paid', payment_id: 'pay_c', txHash: '0x2', receiver: EVM_ADDR }));
    const entries = await readPaymentLinks({ chain: 'fast', direction: 'paid' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.payment_id, 'pay_b');
  });
});

// ─── findPaidLink ───────────────────────────────────────────────────────────

describe('findPaidLink', () => {
  it('returns null when no entries exist', async () => {
    const result = await findPaidLink('pay_nonexistent');
    assert.equal(result, null);
  });

  it('returns null when no paid entry matches', async () => {
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_target', direction: 'created' }));
    const result = await findPaidLink('pay_target');
    assert.equal(result, null);
  });

  it('returns the paid entry when it exists', async () => {
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_target', direction: 'created' }));
    await appendPaymentLink(sampleEntry({
      payment_id: 'pay_target',
      direction: 'paid',
      txHash: '0xdeadbeef',
      ts: '2026-03-01T13:00:00.000Z',
    }));
    const result = await findPaidLink('pay_target');
    assert.ok(result);
    assert.equal(result.direction, 'paid');
    assert.equal(result.payment_id, 'pay_target');
    assert.equal(result.txHash, '0xdeadbeef');
  });

  it('ignores created entries', async () => {
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_only_created', direction: 'created' }));
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_only_created', direction: 'created', ts: '2026-03-01T14:00:00.000Z' }));
    const result = await findPaidLink('pay_only_created');
    assert.equal(result, null);
  });

  it('does not match different payment_id', async () => {
    await appendPaymentLink(sampleEntry({ payment_id: 'pay_other', direction: 'paid', txHash: '0x111' }));
    const result = await findPaidLink('pay_target');
    assert.equal(result, null);
  });
});

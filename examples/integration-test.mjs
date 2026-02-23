/**
 * @fast/money SDK — Fast chain integration test
 * Tests: setup, faucet, balance, send, request
 */

import { money } from '../dist/index.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const KEYFILE = path.join(os.homedir(), '.money/keys/fast.json');

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function log(label, value) {
  if (typeof value === 'object') {
    console.log(`  ${label}:`, JSON.stringify(value, null, 2));
  } else {
    console.log(`  ${label}: ${value}`);
  }
}

async function getKeyfileAddress() {
  try {
    const raw = await readFile(KEYFILE, 'utf-8');
    const kf = JSON.parse(raw);
    return kf.publicKey;
  } catch {
    return null;
  }
}

// ── STEP 1: setup ─────────────────────────────────────────────────────────────
section('STEP 1: money.setup("fast")');
let setupResult;
try {
  setupResult = await money.setup('fast');
  log('Result', setupResult);
  log('Chain', setupResult.chain);
  log('Address', setupResult.address);
  log('Network', setupResult.network);
} catch (err) {
  console.error('  ERROR:', err.message);
  process.exit(1);
}

const setupAddress = setupResult.address;

// Check what's on disk
const pubKeyOnDisk = await getKeyfileAddress();
log('Keyfile pubkey (hex)', pubKeyOnDisk ?? '(none)');

// ── STEP 2: faucet ────────────────────────────────────────────────────────────
section('STEP 2: money.faucet("fast")');
let faucetResult;
try {
  faucetResult = await money.faucet('fast');
  log('Result', faucetResult);
  log('TX Hash', faucetResult.txHash);
  log('Amount', faucetResult.amount);
  log('Token', faucetResult.token);
} catch (err) {
  console.error('  ERROR:', err.message);
  faucetResult = null;
}

// ── STEP 3: balance ───────────────────────────────────────────────────────────
section('STEP 3: money.balance("fast")');
let balanceResult;
try {
  balanceResult = await money.balance('fast');
  log('Result', balanceResult);
  log('Address used', balanceResult.address);
  if (balanceResult.address !== setupAddress) {
    console.log('  ⚠️  WARNING: Address changed from setup! Bug still present.');
    console.log(`  setup address:   ${setupAddress}`);
    console.log(`  balance address: ${balanceResult.address}`);
  } else {
    console.log('  ✅ Address stable — wallet bug is FIXED');
  }
} catch (err) {
  console.error('  ERROR:', err.message);
  balanceResult = null;
}

// ── STEP 4: send ──────────────────────────────────────────────────────────────
section('STEP 4: money.send(recipientAddress, 1)');
// Use setup address as recipient (send to self) — valid as a test
const hasBalance = balanceResult && parseFloat(balanceResult.amount) > 0;
if (!hasBalance) {
  console.log('  ⚠️  SKIPPED: No balance to send (faucet likely failed or RPC down)');
} else {
  try {
    const sendResult = await money.send(setupAddress, 1);
    log('Result', sendResult);
    log('TX Hash', sendResult.txHash);
    log('Explorer', sendResult.explorerUrl);
    log('Fee', sendResult.fee);
  } catch (err) {
    console.error('  ERROR:', err.message);
  }
}

// ── STEP 5: request ───────────────────────────────────────────────────────────
section('STEP 5: money.request(5, { chain: "fast" })');
try {
  const requestResult = await money.request(5, { chain: 'fast' });
  log('Result', requestResult);
  log('Payment URL', requestResult.paymentUrl);
  log('Address', requestResult.address);
  log('Token', requestResult.token);
  log('Amount', requestResult.amount);
  if (requestResult.address !== setupAddress) {
    console.log('  ⚠️  WARNING: Address changed from setup! Bug still present.');
  } else {
    console.log('  ✅ Address stable — wallet bug is FIXED');
  }
} catch (err) {
  console.error('  ERROR:', err.message);
}

// ── STEP 6: RPC health check ──────────────────────────────────────────────────
section('STEP 6: Direct RPC health check');
try {
  const res = await fetch('https://rpc.testnet.fast.link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'fast_getStatus', params: [] }),
  });
  const text = await res.text();
  log('HTTP status', res.status);
  log('Response body (raw)', text.slice(0, 500));
} catch (err) {
  console.error('  RPC connection ERROR:', err.message);
}

section('DONE');
console.log('  All steps complete.\n');

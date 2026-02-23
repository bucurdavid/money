/**
 * Agent Money Task — using @fast/money SDK wallet + direct MCP calls
 * The SDK's rpc.testnet.fast.link doesn't resolve, so we use the production MCP server directly.
 *
 * SDK wallet (new): ~/.money/keys/fast.json → set17swltgf3yhyzdyz9caugz2xn3826tumxy2fa3pe3xztwpqyzll6sad83xg
 * Target address:   set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Import @fast/money SDK (for wallet/address info) ──────────────────────────
import { money } from '/home/deployer/pi/money/dist/index.js';

// ── Ed25519 signing (same deps as the SDK uses) ───────────────────────────────
import * as ed from '/home/deployer/pi/money/node_modules/@noble/ed25519/index.js';
import { sha512 } from '/home/deployer/pi/money/node_modules/@noble/hashes/sha512.js';
ed.etc.sha512Sync = (...msgs) => sha512(msgs.length === 1 ? msgs[0] : new Uint8Array(msgs.reduce((a, m) => { const r = new Uint8Array(a.length + m.length); r.set(a); r.set(m, a.length); return r; }, new Uint8Array(0))));

const MCP = 'https://fast-payment-links-production.up.railway.app/mcp';
const TARGET = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';

// ── Call an MCP tool ───────────────────────────────────────────────────────────
async function callTool(name, args) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  // Parse SSE-style "data: {...}" or raw JSON
  const match = text.match(/^data: (.+)$/m);
  const json = JSON.parse(match ? match[1] : text);
  if (json.error) throw new Error(`MCP error: ${JSON.stringify(json.error)}`);
  const content = json.result?.content;
  if (!content?.length) return json.result;
  const textContent = content.find(c => c.type === 'text')?.text;
  return textContent ? JSON.parse(textContent) : content;
}

// ── Sign transaction bytes with the SDK wallet key ────────────────────────────
async function signTx(txBytesHex) {
  const keyfile = join(homedir(), '.money', 'keys', 'fast.json');
  const wallet = JSON.parse(readFileSync(keyfile, 'utf-8'));
  const sk = Uint8Array.from(Buffer.from(wallet.privateKey, 'hex'));
  const txBytes = Uint8Array.from(Buffer.from(txBytesHex, 'hex'));

  // FastSet signing: "Transaction::" prefix + tx bytes
  const prefix = new TextEncoder().encode('Transaction::');
  const message = new Uint8Array(prefix.length + txBytes.length);
  message.set(prefix, 0);
  message.set(txBytes, prefix.length);

  const signature = await ed.signAsync(message, sk);
  return Buffer.from(signature).toString('hex');
}

async function run() {
  // ── STEP 1: Wallet setup (already done by SDK) ──────────────────────────────
  console.log('=== STEP 1: Wallet Setup (via @fast/money SDK) ===');
  const walletInfo = await money.setup('fast');
  console.log(JSON.stringify(walletInfo, null, 2));
  const myAddress = walletInfo.address;

  // ── STEP 2: Faucet ─────────────────────────────────────────────────────────
  console.log('\n=== STEP 2: Faucet Drip (via MCP) ===');
  try {
    const faucetResult = await callTool('faucet_drip', { recipient: myAddress });
    console.log(JSON.stringify(faucetResult, null, 2));
  } catch (e) {
    console.log('Faucet error:', e.message);
  }

  // Small delay for balance to update
  await new Promise(r => setTimeout(r, 2000));

  // ── STEP 3: Check balance ──────────────────────────────────────────────────
  console.log('\n=== STEP 3: Check Balance (via MCP) ===');
  try {
    const balance = await callTool('check_balance', { address: myAddress });
    console.log(JSON.stringify(balance, null, 2));
  } catch (e) {
    console.log('Balance error:', e.message);
  }

  // ── STEP 4: Send 1 SET ─────────────────────────────────────────────────────
  console.log('\n=== STEP 4: Send 1 SET to', TARGET, '===');
  try {
    // Build transaction
    console.log('Building transaction...');
    const built = await callTool('build_payment', {
      sender: myAddress,
      receiver: TARGET,
      amount: '1',
      token_id: 'native',
      memo: 'agent payment',
    });
    console.log('Built:', JSON.stringify(built, null, 2));

    const txBytes = built.tx_bytes;
    if (!txBytes) throw new Error('No tx_bytes in build response');

    // Sign
    console.log('Signing...');
    const signature = await signTx(txBytes);
    console.log('Signature:', signature.slice(0, 20) + '...');

    // Submit
    console.log('Submitting...');
    const submitted = await callTool('submit_transaction', { tx_bytes: txBytes, signature });
    console.log('Submitted:', JSON.stringify(submitted, null, 2));
  } catch (e) {
    console.log('Send error:', e.message);
  }

  // ── STEP 5: Generate payment request link for 5 SET ────────────────────────
  console.log('\n=== STEP 5: Payment Request Link for 5 SET (via MCP) ===');
  try {
    const link = await callTool('create_payment_link', {
      receiver: myAddress,
      amount: '5',
      memo: 'agent payment request',
    });
    console.log(JSON.stringify(link, null, 2));
  } catch (e) {
    console.log('Payment link error:', e.message);
  }
}

run().catch(console.error);

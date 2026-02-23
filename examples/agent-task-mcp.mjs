/**
 * Agent task: send/receive money using @fast/money SDK
 * - SDK used for wallet setup, signing, payment link generation
 * - MCP server used for network operations (faucet, balance, send)
 *   since rpc.testnet.fast.link is currently unreachable via DNS
 */
import { money } from '/home/deployer/pi/money/dist/index.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as ed from '/home/deployer/pi/money/node_modules/@noble/ed25519/index.js';
import { sha512 } from '/home/deployer/pi/money/node_modules/@noble/hashes/sha512.js';

// Configure ed25519 sha512
ed.etc.sha512Sync = (...msgs) =>
  sha512(msgs.length === 1 ? msgs[0] : new Uint8Array(msgs.reduce((a, m) => {
    const r = new Uint8Array(a.length + m.length); r.set(a); r.set(m, a.length); return r;
  }, new Uint8Array(0))));

const MCP = 'https://fast-payment-links-production.up.railway.app/mcp';
const TARGET = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';

async function mcpCall(toolName, args) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolName, arguments: args }, id: Date.now() }),
  });
  const text = await res.text();
  // Parse SSE or JSON response
  const jsonLine = text.split('\n').find(l => l.startsWith('data:'));
  const parsed = JSON.parse(jsonLine ? jsonLine.replace('data: ', '') : text);
  if (parsed.error) throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
  const content = parsed.result?.content?.[0]?.text;
  return content ? JSON.parse(content) : parsed.result;
}

async function signTx(txBytesHex, privateKeyHex) {
  const privKeyBuf = Buffer.from(privateKeyHex, 'hex');
  const txBytes = Buffer.from(txBytesHex, 'hex');
  const prefix = new TextEncoder().encode('Transaction::');
  const message = new Uint8Array(prefix.length + txBytes.length);
  message.set(prefix, 0);
  message.set(txBytes, prefix.length);
  const signature = await ed.signAsync(message, privKeyBuf);
  return Buffer.from(signature).toString('hex');
}

async function main() {
  // ── Step 1: Setup wallet via @fast/money SDK ──────────────────────────────
  console.log('\n=== Step 1: Setup Fast wallet (@fast/money SDK) ===');
  let walletResult;
  try {
    walletResult = await money.setup('fast');
    console.log(JSON.stringify(walletResult, null, 2));
  } catch (e) {
    console.log('Setup note:', e.message);
  }

  // Load the agent address from SDK key file
  const keyFile = join(homedir(), '.money', 'keys', 'fast.json');
  const keyData = JSON.parse(await readFile(keyFile, 'utf-8'));
  
  // Derive agent address from public key using SDK's bech32m encoding
  const balCheck = await money.balance('fast').catch(() => null);
  const agentAddress = balCheck?.address ?? walletResult?.address;
  console.log('Agent address:', agentAddress);

  // ── Step 2: Get testnet tokens from faucet via MCP ───────────────────────
  console.log('\n=== Step 2: Faucet (MCP faucet_drip) ===');
  try {
    const faucet = await mcpCall('faucet_drip', { recipient: agentAddress });
    console.log(JSON.stringify(faucet, null, 2));
  } catch (e) {
    console.log('Faucet error:', e.message);
  }

  // ── Step 3: Check balance via MCP ─────────────────────────────────────────
  console.log('\n=== Step 3: Check balance (MCP check_balance) ===');
  let balance;
  try {
    balance = await mcpCall('check_balance', { address: agentAddress });
    console.log(JSON.stringify(balance, null, 2));
  } catch (e) {
    console.log('Balance error:', e.message);
  }

  // ── Step 4: Send 1 SET via MCP + SDK signing ──────────────────────────────
  console.log('\n=== Step 4: Send 1 SET to target address ===');
  try {
    // Build transaction
    const built = await mcpCall('build_payment', {
      sender: agentAddress,
      receiver: TARGET,
      amount: '1',
    });
    console.log('Built tx:', JSON.stringify(built, null, 2));

    // Sign with SDK private key
    const signature = await signTx(built.tx_bytes, keyData.privateKey);
    console.log('Signature:', signature);

    // Submit
    const submitted = await mcpCall('submit_transaction', {
      tx_bytes: built.tx_bytes,
      signature,
    });
    console.log('Submitted:', JSON.stringify(submitted, null, 2));
  } catch (e) {
    console.log('Send error:', e.message);
  }

  // ── Step 5: Generate payment request link via @fast/money SDK ─────────────
  console.log('\n=== Step 5: Payment request link for 5 SET (@fast/money SDK) ===');
  try {
    const link = await money.request(5, { chain: 'fast', memo: 'agent payment request' });
    console.log(JSON.stringify(link, null, 2));
  } catch (e) {
    // Fallback: use MCP create_payment_link
    console.log('SDK request failed, falling back to MCP:', e.message);
    try {
      const mcpLink = await mcpCall('create_payment_link', {
        receiver: agentAddress,
        amount: '5',
        memo: 'agent payment request',
      });
      console.log(JSON.stringify(mcpLink, null, 2));
    } catch (e2) {
      console.log('MCP link error:', e2.message);
    }
  }
}

main().catch(e => console.error('Fatal:', e));

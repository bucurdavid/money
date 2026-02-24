import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createSolanaAdapter } from './solana.js';
import { MoneyError } from '../errors.js';

// ---------------------------------------------------------------------------
// Local JSON-RPC server helper
// ---------------------------------------------------------------------------

type RpcHandler = Record<string, unknown | ((params: unknown[]) => unknown)>;

function createRpcServer(handlers: RpcHandler): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { method: string; id: number; params?: unknown[] };
          const handler = handlers[parsed.method];
          let result: unknown = null;
          if (handler !== undefined) {
            result = typeof handler === 'function'
              ? (handler as (params: unknown[]) => unknown)(parsed.params ?? [])
              : handler;
          }
          const response = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(response);
        } catch {
          res.writeHead(500);
          res.end('Internal error');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

function createRpcErrorServer(
  errorMethod: string,
  errorMsg: string,
  errorCode: number,
  fallbackHandlers: RpcHandler,
): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { method: string; id: number; params?: unknown[] };
          if (parsed.method === errorMethod) {
            const response = JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              error: { code: errorCode, message: errorMsg },
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(response);
            return;
          }
          const handler = fallbackHandlers[parsed.method];
          let result: unknown = null;
          if (handler !== undefined) {
            result = typeof handler === 'function'
              ? (handler as (params: unknown[]) => unknown)(parsed.params ?? [])
              : handler;
          }
          const response = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(response);
        } catch {
          res.writeHead(500);
          res.end('Internal error');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_TOKENS = {
  USDC: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 },
};

let tmpDir: string;
let rpcServer: http.Server | null = null;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-solana-test-'));
});

afterEach(async () => {
  if (rpcServer) {
    rpcServer.close();
    rpcServer = null;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSolanaAdapter', () => {
  it('returns adapter with chain "solana"', () => {
    const adapter = createSolanaAdapter('http://localhost:1234', TEST_TOKENS);
    assert.equal(adapter.chain, 'solana');
  });

  it('addressPattern matches base58 addresses', () => {
    const adapter = createSolanaAdapter('http://localhost:1234', TEST_TOKENS);
    assert.ok(adapter.addressPattern.test('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'));
    assert.ok(adapter.addressPattern.test('11111111111111111111111111111111'));
    assert.ok(adapter.addressPattern.test('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
  });

  it('addressPattern rejects non-Solana addresses', () => {
    const adapter = createSolanaAdapter('http://localhost:1234', TEST_TOKENS);
    assert.ok(!adapter.addressPattern.test('set1abc123'));
    assert.ok(!adapter.addressPattern.test('0x' + 'a'.repeat(40)));
    assert.ok(!adapter.addressPattern.test(''));
    assert.ok(!adapter.addressPattern.test('0000000000000000000000000000000000'));
  });
});

describe('setupWallet', () => {
  it('creates keyfile and returns base58 address', async () => {
    const adapter = createSolanaAdapter('http://localhost:1234', TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const result = await adapter.setupWallet(keyfile);

    assert.ok(result.address.length >= 32 && result.address.length <= 44,
      `address length should be 32-44, got ${result.address.length}`);
    assert.ok(adapter.addressPattern.test(result.address),
      `address should match Solana pattern: ${result.address}`);
    const stat = await fs.stat(keyfile);
    assert.ok(stat.isFile());
  });

  it('is idempotent — returns same address on second call', async () => {
    const adapter = createSolanaAdapter('http://localhost:1234', TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const r1 = await adapter.setupWallet(keyfile);
    const r2 = await adapter.setupWallet(keyfile);
    assert.equal(r1.address, r2.address);
  });
});

describe('getBalance', () => {
  it('fetches SOL balance via getBalance RPC', async () => {
    const { url, server } = await createRpcServer({
      getBalance: { context: { slot: 100 }, value: 1_000_000_000 }, // 1 SOL
    });
    rpcServer = server;

    const adapter = createSolanaAdapter(url, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const { address } = await adapter.setupWallet(keyfile);

    const bal = await adapter.getBalance(address);
    assert.equal(bal.amount, '1');
    assert.equal(bal.token, 'SOL');
  });

  it('returns "0" when getBalance returns 0 lamports', async () => {
    const { url, server } = await createRpcServer({
      getBalance: { context: { slot: 100 }, value: 0 },
    });
    rpcServer = server;

    const adapter = createSolanaAdapter(url, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const { address } = await adapter.setupWallet(keyfile);

    const bal = await adapter.getBalance(address);
    assert.equal(bal.amount, '0');
    assert.equal(bal.token, 'SOL');
  });

  it('throws for unconfigured SPL token', async () => {
    const adapter = createSolanaAdapter('http://localhost:1234', TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const { address } = await adapter.setupWallet(keyfile);

    await assert.rejects(
      () => adapter.getBalance(address, 'UNKNOWN_TOKEN'),
      (err: Error) => {
        assert.ok(err.message.includes('UNKNOWN_TOKEN'));
        return true;
      },
    );
  });

  it('returns "0" for SPL token when account does not exist', async () => {
    const { url, server } = await createRpcServer({
      getAccountInfo: { context: { slot: 100 }, value: null },
    });
    rpcServer = server;

    const adapter = createSolanaAdapter(url, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const { address } = await adapter.setupWallet(keyfile);

    const bal = await adapter.getBalance(address, 'USDC');
    assert.equal(bal.amount, '0');
    assert.equal(bal.token, 'USDC');
  });
});

// NOTE: faucet test skipped — confirmTransaction uses WebSocket subscriptions
// internally which can't be easily mocked with a plain HTTP server.
// The faucet method is a thin wrapper around web3.js requestAirdrop + confirmTransaction.
// Tested via integration tests against devnet instead.

describe('send', () => {
  it('maps Solana "debit an account" errors to MoneyError("INSUFFICIENT_BALANCE")', async () => {
    const fallback: RpcHandler = {
      getLatestBlockhash: {
        context: { slot: 100 },
        value: {
          blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
          lastValidBlockHeight: 200,
        },
      },
      getFeeForMessage: { context: { slot: 100 }, value: 5000 },
    };

    const { url, server } = await createRpcErrorServer(
      'sendTransaction',
      'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.',
      -32002,
      fallback,
    );
    rpcServer = server;

    const adapter = createSolanaAdapter(url, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const { address: fromAddr } = await adapter.setupWallet(keyfile);

    const keyfile2 = path.join(tmpDir, 'keys', 'solana2.json');
    const { address: toAddr } = await adapter.setupWallet(keyfile2);

    await assert.rejects(
      () => adapter.send({ from: fromAddr, to: toAddr, amount: '1000', keyfile }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `Expected MoneyError, got: ${err}`);
        assert.equal((err as MoneyError).code, 'INSUFFICIENT_BALANCE');
        return true;
      },
    );
  });

  it('wraps other errors as MoneyError("TX_FAILED")', async () => {
    const fallback: RpcHandler = {
      getLatestBlockhash: {
        context: { slot: 100 },
        value: {
          blockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
          lastValidBlockHeight: 200,
        },
      },
    };

    const { url, server } = await createRpcErrorServer(
      'sendTransaction',
      'some random RPC error',
      -32000,
      fallback,
    );
    rpcServer = server;

    const adapter = createSolanaAdapter(url, TEST_TOKENS);
    const keyfile = path.join(tmpDir, 'keys', 'solana.json');
    const { address: fromAddr } = await adapter.setupWallet(keyfile);

    const keyfile2 = path.join(tmpDir, 'keys', 'solana2.json');
    const { address: toAddr } = await adapter.setupWallet(keyfile2);

    await assert.rejects(
      () => adapter.send({ from: fromAddr, to: toAddr, amount: '1', keyfile }),
      (err: unknown) => {
        assert.ok(err instanceof MoneyError, `Expected MoneyError, got: ${err}`);
        assert.equal((err as MoneyError).code, 'TX_FAILED');
        return true;
      },
    );
  });
});



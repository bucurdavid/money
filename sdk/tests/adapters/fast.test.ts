import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFastAdapter } from '../../src/adapters/fast.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_RPC = 'https://proxy.test.xyz';

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
let tmpDir: string;

/** Capture the last RPC call's method and params */
function capturingFetch(
  response: unknown,
): { fetch: FetchFn; captured: () => { method: string; params: unknown } } {
  let lastBody: { method: string; params: unknown } = { method: '', params: {} };
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    lastBody = JSON.parse(bodyText);
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: response }),
    } as Response;
  }) as FetchFn;
  return { fetch: fn, captured: () => lastBody };
}

function failingFetch(): FetchFn {
  return (() => {
    throw new Error('network down');
  }) as unknown as FetchFn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createFastAdapter', () => {
  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-fast-test-'));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns an adapter with chain set to "fast"', () => {
    const adapter = createFastAdapter(FAKE_RPC);
    assert.equal(adapter.chain, 'fast');
  });

  it('addressPattern matches valid set1 addresses', () => {
    const adapter = createFastAdapter(FAKE_RPC);
    assert.ok(
      adapter.addressPattern.test(
        'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc',
      ),
    );
    assert.ok(!adapter.addressPattern.test('0x1234'));
  });

  describe('setupWallet', () => {
    it('creates a keyfile and returns a set1... address', async () => {
      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      const result = await adapter.setupWallet(keyfile);

      assert.ok(result.address.startsWith('set1'));
      const stat = await fs.stat(keyfile);
      assert.ok(stat.isFile());
    });

    it('returns the same address on subsequent calls (idempotent)', async () => {
      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      const r1 = await adapter.setupWallet(keyfile);
      const r2 = await adapter.setupWallet(keyfile);
      assert.equal(r1.address, r2.address);
    });
  });

  describe('getBalance', () => {
    it('parses hex balance from proxy_getAccountInfo', async () => {
      const { fetch, captured } = capturingFetch({
        balance: 'de0b6b3a7640000', // 1 SET
        next_nonce: 0,
      });
      globalThis.fetch = fetch;

      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      const { address } = await adapter.setupWallet(keyfile);

      const bal = await adapter.getBalance(address);
      assert.equal(bal.amount, '1');
      assert.equal(bal.token, 'SET');
      assert.equal(captured().method, 'proxy_getAccountInfo');
    });

    it('throws on RPC/network failure (not silent "0")', async () => {
      globalThis.fetch = failingFetch();
      const adapter = createFastAdapter(FAKE_RPC);
      await assert.rejects(
        () => adapter.getBalance(
          'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc',
        ),
        (err: Error) => {
          assert.ok(err.message.includes('network down'));
          return true;
        },
      );
    });

    it('returns "0" when account does not exist (null result)', async () => {
      const { fetch } = capturingFetch(null);
      globalThis.fetch = fetch;
      const adapter = createFastAdapter(FAKE_RPC);
      const bal = await adapter.getBalance(
        'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc',
      );
      assert.equal(bal.amount, '0');
    });

    it('handles large balances correctly', async () => {
      // 5000 SET = 5000 * 10^18 = 0x10F0CF064DD59200000
      const { fetch } = capturingFetch({
        balance: '10f0cf064dd59200000',
        next_nonce: 0,
      });
      globalThis.fetch = fetch;

      const adapter = createFastAdapter(FAKE_RPC);
      const bal = await adapter.getBalance(
        'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc',
      );
      assert.equal(bal.amount, '5000');
    });

    it('returns token balance for non-native tokens by hex token ID', async () => {
      // token_id: [0x01, 0x02, 0x00 × 30] — 32 bytes
      const tokenId = [0x01, 0x02, ...Array(30).fill(0)];
      // balance '0xDE0B6B3A7640000' = 1e18 raw = 1.0 token
      const { fetch } = capturingFetch({
        balance: 'de0b6b3a7640000', // native SET (unused in this test)
        token_balance: [
          { token_id: tokenId, balance: '0xDE0B6B3A7640000' },
        ],
        next_nonce: 0,
      });
      globalThis.fetch = fetch;

      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      const { address } = await adapter.setupWallet(keyfile);

      // '0x' + '0102' + '00' × 30 = 64 hex chars = 32 bytes, left-aligned
      const hexTokenId = '0x' + '0102' + '00'.repeat(30);
      const bal = await adapter.getBalance(address, hexTokenId);
      assert.equal(bal.amount, '1');
      assert.equal(bal.token, hexTokenId);
    });

    it('returns "0" when hex token ID is not found in token_balance', async () => {
      const { fetch } = capturingFetch({
        balance: 'de0b6b3a7640000',
        token_balance: [], // empty — no matching entry
        next_nonce: 0,
      });
      globalThis.fetch = fetch;

      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      const { address } = await adapter.setupWallet(keyfile);

      const hexTokenId = '0x' + '0304' + '00'.repeat(30);
      const bal = await adapter.getBalance(address, hexTokenId);
      assert.equal(bal.amount, '0');
      assert.equal(bal.token, hexTokenId);
    });

    it('throws TOKEN_NOT_FOUND for unknown non-hex token names', async () => {
      const { fetch } = capturingFetch({
        balance: 'de0b6b3a7640000',
        token_balance: [],
        next_nonce: 0,
      });
      globalThis.fetch = fetch;

      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      const { address } = await adapter.setupWallet(keyfile);

      await assert.rejects(
        () => adapter.getBalance(address, 'UNKNOWNTOKEN'),
        (err: Error) => {
          assert.ok(err.message.includes('TOKEN_NOT_FOUND') || err.message.includes('not found'));
          return true;
        },
      );
    });
  });

  describe('send', () => {
    it('builds a BCS transaction and calls proxy_submitTransaction', async () => {
      // First call: getAccountInfo for nonce. Second call: submitTransaction.
      let callCount = 0;
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        callCount++;
        const bodyText = typeof init?.body === 'string' ? init.body : '';
        const parsed = JSON.parse(bodyText);

        if (parsed.method === 'proxy_getAccountInfo') {
          return {
            ok: true,
            json: async () => ({
              jsonrpc: '2.0',
              id: 1,
              result: { balance: 'de0b6b3a7640000', next_nonce: 5 },
            }),
          } as Response;
        }

        // proxy_submitTransaction
        assert.equal(parsed.method, 'proxy_submitTransaction');
        assert.ok(parsed.params.transaction, 'should have transaction');
        assert.ok(parsed.params.signature, 'should have signature');
        assert.ok(parsed.params.signature.Signature, 'signature wrapped in enum');

        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: { Success: { envelope: { hash: 'abc123' }, signatures: [] } },
          }),
        } as Response;
      }) as FetchFn;

      const adapter = createFastAdapter(FAKE_RPC);
      const keyfile = path.join(tmpDir, 'keys', 'fast.json');
      await adapter.setupWallet(keyfile);

      // Create a second wallet for recipient
      const keyfile2 = path.join(tmpDir, 'keys', 'fast2.json');
      const { address: toAddr } = await adapter.setupWallet(keyfile2);

      // Restore mocked fetch for the send
      const { address: fromAddr } = await adapter.setupWallet(keyfile);

      const result = await adapter.send({
        from: fromAddr,
        to: toAddr,
        amount: '1',
        keyfile,
      });

      assert.ok(callCount >= 2, 'should have called RPC at least twice');
      assert.equal(result.fee, '0.01');
    });
  });

  describe('faucet', () => {
    it('calls proxy_faucetDrip then checks balance', async () => {
      // Faucet returns null, then getBalance is called to check actual balance
      let callCount = 0;
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        callCount++;
        const bodyText = typeof init?.body === 'string' ? init.body : '';
        const parsed = JSON.parse(bodyText);

        if (parsed.method === 'proxy_faucetDrip') {
          // Verify params
          assert.ok(Array.isArray(parsed.params.recipient), 'recipient should be array');
          assert.equal(parsed.params.recipient.length, 32);
          return {
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id: 1, result: null }),
          } as Response;
        }

        // proxy_getAccountInfo for balance check after faucet
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: { balance: '21e0ac544cd98a00000', next_nonce: 0 }, // ~9999.99 SET (after fees)
          }),
        } as Response;
      }) as FetchFn;

      const adapter = createFastAdapter(FAKE_RPC);
      const result = await adapter.faucet(
        'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc',
      );

      assert.ok(callCount >= 2, 'should call faucet then getBalance');
      assert.equal(result.token, 'SET');
      // Amount should reflect actual balance, not hardcoded drip
      assert.ok(parseFloat(result.amount) > 0, 'should have a positive balance');
    });
  });
});

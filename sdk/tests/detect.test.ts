import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { identifyChains, isValidAddress, getAddressPattern } from '../src/detect.js';

// ─── Realistic test addresses ──────────────────────────────────────────────
// fast: 'set1' + 38+ lowercase alphanumeric chars (real wallet address)
const FAST_ADDR    = 'set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc';
// evm: '0x' + 40 hex chars
const EVM_ADDR     = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
// solana: base58, 44 chars (like a real pubkey)
const SOLANA_ADDR  = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
// invalid: clearly wrong
const INVALID_ADDR = 'not-a-valid-address';

// ─── Temp config dir ─────────────────────────────────────────────────────────

let tmpDir: string;
const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-detect-test-'));
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

// ─── identifyChains ────────────────────────────────────────────────────────
describe('identifyChains', () => {
  it('returns ["fast"] for a fast (bech32m) address', async () => {
    assert.deepStrictEqual(await identifyChains(FAST_ADDR), ['fast']);
  });

  it('returns all 3 built-in EVM chains for an EVM address', async () => {
    assert.deepStrictEqual(await identifyChains(EVM_ADDR), ['base', 'ethereum', 'arbitrum']);
  });

  it('returns ["solana"] for a solana (base58) address', async () => {
    assert.deepStrictEqual(await identifyChains(SOLANA_ADDR), ['solana']);
  });

  it('returns [] for an invalid address', async () => {
    assert.deepStrictEqual(await identifyChains(INVALID_ADDR), []);
  });

  it('returns [] for an empty string', async () => {
    assert.deepStrictEqual(await identifyChains(''), []);
  });

  it('includes custom EVM chains from config', async () => {
    // Write a config with a custom EVM chain
    const config = {
      chains: { 'polygon:mainnet': { rpc: 'https://polygon-rpc.com', keyfile: '~/.money/keys/evm.json', network: 'mainnet', defaultToken: 'MATIC' } },
      customChains: { polygon: { type: 'evm', chainId: 137 } },
    };
    await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(config), 'utf-8');

    const chains = await identifyChains(EVM_ADDR);
    assert.ok(chains.includes('polygon'), 'should include custom EVM chain "polygon"');
    assert.ok(chains.includes('base'), 'should still include built-in "base"');
    assert.ok(chains.includes('ethereum'), 'should still include built-in "ethereum"');
    assert.ok(chains.includes('arbitrum'), 'should still include built-in "arbitrum"');
  });
});

// ─── isValidAddress ────────────────────────────────────────────────────────
describe('isValidAddress', () => {
  it('returns true for a valid fast address with chain "fast"', async () => {
    assert.equal(await isValidAddress(FAST_ADDR, 'fast'), true);
  });

  it('returns true for a valid EVM address with chain "base"', async () => {
    assert.equal(await isValidAddress(EVM_ADDR, 'base'), true);
  });

  it('returns true for a valid EVM address with chain "ethereum" (shared EVM pattern)', async () => {
    assert.equal(await isValidAddress(EVM_ADDR, 'ethereum'), true);
  });

  it('returns true for a valid EVM address with chain "arbitrum"', async () => {
    assert.equal(await isValidAddress(EVM_ADDR, 'arbitrum'), true);
  });

  it('returns true for a valid solana address with chain "solana"', async () => {
    assert.equal(await isValidAddress(SOLANA_ADDR, 'solana'), true);
  });

  it('returns false for an invalid address with chain "fast"', async () => {
    assert.equal(await isValidAddress(INVALID_ADDR, 'fast'), false);
  });

  it('returns false for a fast address checked against chain "base"', async () => {
    assert.equal(await isValidAddress(FAST_ADDR, 'base'), false);
  });

  it('returns false for an EVM address checked against chain "solana"', async () => {
    assert.equal(await isValidAddress(EVM_ADDR, 'solana'), false);
  });

  it('returns false for an unknown chain (not in config)', async () => {
    assert.equal(await isValidAddress(EVM_ADDR, 'unknown'), false);
  });

  it('returns true for EVM address with composite key "base:mainnet"', async () => {
    assert.equal(await isValidAddress(EVM_ADDR, 'base:mainnet'), true);
  });

  it('returns true for custom EVM chain from config', async () => {
    const config = {
      chains: { polygon: { rpc: 'https://polygon-rpc.com', keyfile: '~/.money/keys/evm.json', network: 'testnet', defaultToken: 'MATIC' } },
      customChains: { polygon: { type: 'evm', chainId: 137 } },
    };
    await fs.writeFile(path.join(tmpDir, 'config.json'), JSON.stringify(config), 'utf-8');

    assert.equal(await isValidAddress(EVM_ADDR, 'polygon'), true);
    assert.equal(await isValidAddress(FAST_ADDR, 'polygon'), false);
  });
});

// ─── getAddressPattern ─────────────────────────────────────────────────────
describe('getAddressPattern', () => {
  it('returns the fast regex for chain "fast"', async () => {
    const pattern = await getAddressPattern('fast');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test(FAST_ADDR));
    assert.ok(!pattern.test(EVM_ADDR));
  });

  it('returns the evm regex for chain "base"', async () => {
    const pattern = await getAddressPattern('base');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern!.test(EVM_ADDR));
    assert.ok(!pattern!.test(FAST_ADDR));
  });

  it('returns the evm regex for chain "ethereum"', async () => {
    const pattern = await getAddressPattern('ethereum');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern!.test(EVM_ADDR));
  });

  it('returns the evm regex for chain "arbitrum"', async () => {
    const pattern = await getAddressPattern('arbitrum');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern!.test(EVM_ADDR));
  });

  it('"base", "ethereum", and "arbitrum" all return the same pattern instance', async () => {
    assert.deepStrictEqual(await getAddressPattern('base'), await getAddressPattern('ethereum'));
    assert.deepStrictEqual(await getAddressPattern('ethereum'), await getAddressPattern('arbitrum'));
  });

  it('returns the solana regex for chain "solana"', async () => {
    const pattern = await getAddressPattern('solana');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern!.test(SOLANA_ADDR));
    assert.ok(!pattern!.test(EVM_ADDR));
  });

  it('returns null for an unknown chain', async () => {
    assert.equal(await getAddressPattern('unknown'), null);
  });

  it('returns evm regex for composite key "base:mainnet"', async () => {
    const pattern = await getAddressPattern('base:mainnet');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern!.test(EVM_ADDR));
  });

  it('returns fast regex for composite key "fast:mainnet"', async () => {
    const pattern = await getAddressPattern('fast:mainnet');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern!.test(FAST_ADDR));
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getConfigDir,
  getKeysDir,
  loadConfig,
  saveConfig,
  getChainConfig,
  setChainConfig,
} from '../src/config.js';
import type { ChainConfig, MoneyConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_CONFIG_DIR = process.env.MONEY_CONFIG_DIR;

let tmpDir: string;

async function writeTmpConfig(content: string): Promise<void> {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'config.json'), content, 'utf-8');
}

const sampleChain: ChainConfig = {
  rpc: 'https://rpc.example.com',
  keyfile: 'keys/mykey.json',
  network: 'mainnet',
  defaultToken: 'USDC',
};

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'money-test-'));
  process.env.MONEY_CONFIG_DIR = tmpDir;
});

afterEach(async () => {
  // Restore original env var
  if (ORIGINAL_CONFIG_DIR === undefined) {
    delete process.env.MONEY_CONFIG_DIR;
  } else {
    process.env.MONEY_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  }

  // Clean up temp dir
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getConfigDir
// ---------------------------------------------------------------------------

describe('getConfigDir', () => {
  it('returns the path from MONEY_CONFIG_DIR when set', () => {
    process.env.MONEY_CONFIG_DIR = tmpDir;
    assert.equal(getConfigDir(), tmpDir);
  });

  it('expands ~ in MONEY_CONFIG_DIR', () => {
    process.env.MONEY_CONFIG_DIR = '~/testmoney';
    const expected = path.join(os.homedir(), 'testmoney');
    assert.equal(getConfigDir(), expected);
  });

  it('returns ~/.money when MONEY_CONFIG_DIR is not set', () => {
    delete process.env.MONEY_CONFIG_DIR;
    const expected = path.join(os.homedir(), '.money');
    assert.equal(getConfigDir(), expected);
  });
});

// ---------------------------------------------------------------------------
// getKeysDir
// ---------------------------------------------------------------------------

describe('getKeysDir', () => {
  it('returns <configDir>/keys', () => {
    process.env.MONEY_CONFIG_DIR = tmpDir;
    const expected = path.join(tmpDir, 'keys');
    assert.equal(getKeysDir(), expected);
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  it('returns { chains: {} } when config file does not exist', async () => {
    // tmpDir exists but contains no config.json
    const config = await loadConfig();
    assert.deepEqual(config, { chains: {} });
  });

  it('returns the parsed config when the file is valid', async () => {
    const data: MoneyConfig = {
      chains: {
        fast: sampleChain,
      },
    };
    await writeTmpConfig(JSON.stringify(data));
    const config = await loadConfig();
    assert.deepEqual(config, data);
  });

  it('throws when the file contains invalid JSON', async () => {
    await writeTmpConfig('{ this is not json }');
    await assert.rejects(
      () => loadConfig(),
      (err: Error) => {
        assert.ok(err instanceof Error, 'should be an Error');
        assert.ok(
          err.message.startsWith('Failed to load config from'),
          `unexpected message: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws with a descriptive error when "chains" field is missing', async () => {
    await writeTmpConfig(JSON.stringify({ version: 1 }));
    await assert.rejects(
      () => loadConfig(),
      (err: Error) => {
        assert.ok(err instanceof Error, 'should be an Error');
        assert.ok(
          err.message.includes('chains'),
          `expected message to mention "chains", got: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------

describe('saveConfig', () => {
  it('creates the directory and writes the config file', async () => {
    // Use a subdirectory that does not yet exist
    const subDir = path.join(tmpDir, 'nested', 'config');
    process.env.MONEY_CONFIG_DIR = subDir;

    const data: MoneyConfig = { chains: { fast: sampleChain } };
    await saveConfig(data);

    const written = JSON.parse(
      await fs.readFile(path.join(subDir, 'config.json'), 'utf-8'),
    ) as MoneyConfig;
    assert.deepEqual(written, data);
  });

  it('writes the config file with mode 0600', async () => {
    const data: MoneyConfig = { chains: {} };
    await saveConfig(data);

    const fileStat = await fs.stat(path.join(tmpDir, 'config.json'));
    const fileMode = fileStat.mode & 0o777;
    assert.equal(
      fileMode,
      0o600,
      `expected file mode 0600 but got 0${fileMode.toString(8)}`,
    );
  });

  it('creates the config directory with mode 0700', async () => {
    // Use a fresh directory that saveConfig must create
    const freshDir = path.join(tmpDir, 'fresh');
    process.env.MONEY_CONFIG_DIR = freshDir;

    await saveConfig({ chains: {} });

    const dirStat = await fs.stat(freshDir);
    const dirMode = dirStat.mode & 0o777;
    assert.equal(
      dirMode,
      0o700,
      `expected dir mode 0700 but got 0${dirMode.toString(8)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// getChainConfig
// ---------------------------------------------------------------------------

describe('getChainConfig', () => {
  it('returns the chain config for an existing chain', async () => {
    const data: MoneyConfig = { chains: { fast: sampleChain } };
    await writeTmpConfig(JSON.stringify(data));

    const result = await getChainConfig('fast');
    assert.deepEqual(result, sampleChain);
  });

  it('returns null for a chain that does not exist', async () => {
    const data: MoneyConfig = { chains: {} };
    await writeTmpConfig(JSON.stringify(data));

    const result = await getChainConfig('nonexistent');
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// setChainConfig
// ---------------------------------------------------------------------------

describe('setChainConfig', () => {
  it('adds a new chain config and persists it', async () => {
    // Start with an empty config
    await saveConfig({ chains: {} });

    await setChainConfig('fast', sampleChain);

    const loaded = await loadConfig();
    assert.deepEqual(loaded.chains['fast'], sampleChain);
  });

  it('updates an existing chain config and persists it', async () => {
    const initial: MoneyConfig = { chains: { fast: sampleChain } };
    await writeTmpConfig(JSON.stringify(initial));

    const updated: ChainConfig = { ...sampleChain, rpc: 'https://new-rpc.example.com' };
    await setChainConfig('fast', updated);

    const loaded = await loadConfig();
    assert.deepEqual(loaded.chains['fast'], updated);
  });

  it('preserves existing chain configs when adding a new one', async () => {
    const initial: MoneyConfig = { chains: { fast: sampleChain } };
    await writeTmpConfig(JSON.stringify(initial));

    const otherChain: ChainConfig = {
      rpc: 'https://base-rpc.example.com',
      keyfile: 'keys/basekey.json',
      network: 'mainnet',
      defaultToken: 'ETH',
    };
    await setChainConfig('base', otherChain);

    const loaded = await loadConfig();
    assert.deepEqual(loaded.chains['fast'], sampleChain);
    assert.deepEqual(loaded.chains['base'], otherChain);
  });
});

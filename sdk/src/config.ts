import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MoneyConfig, ChainConfig, CustomChainDef } from './types.js';

/**
 * Returns the expanded path to the config directory (~/.money/ by default).
 * Override with MONEY_CONFIG_DIR env var.
 */
export function getConfigDir(): string {
  const override = process.env.MONEY_CONFIG_DIR;
  if (override) {
    return override.startsWith('~')
      ? path.join(os.homedir(), override.slice(1))
      : override;
  }
  return path.join(os.homedir(), '.money');
}

/**
 * Returns the expanded path to the keys directory (~/.money/keys/).
 */
export function getKeysDir(): string {
  return path.join(getConfigDir(), 'keys');
}

/**
 * Returns the full path to the config file.
 */
function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Load the config from ~/.money/config.json.
 * Returns { chains: {} } if the file does not exist.
 */
export async function loadConfig(): Promise<MoneyConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as MoneyConfig;
    if (!parsed.chains || typeof parsed.chains !== 'object') {
      throw new Error(`Invalid config at ${configPath}: missing "chains" object`);
    }
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { chains: {} };
    }
    throw new Error(
      `Failed to load config from ${configPath}: ${(err as Error).message}`
    );
  }
}

/**
 * Save the config to ~/.money/config.json.
 * Creates ~/.money/ with mode 0700 if needed.
 * Writes the file with mode 0600.
 */
export async function saveConfig(config: MoneyConfig): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  try {
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  } catch (err: unknown) {
    throw new Error(
      `Failed to create config directory ${configDir}: ${(err as Error).message}`
    );
  }

  const content = JSON.stringify(config, null, 2);
  const tmpPath = `${configPath}.tmp.${process.pid}`;
  try {
    await fs.writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmpPath, configPath);
  } catch (err: unknown) {
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    throw new Error(
      `Failed to write config to ${configPath}: ${(err as Error).message}`
    );
  }
}

/**
 * Get the config for a specific chain, or null if not configured.
 */
export async function getChainConfig(chain: string): Promise<ChainConfig | null> {
  const config = await loadConfig();
  return config.chains[chain] ?? null;
}

/**
 * Add or update a chain's config and persist it.
 */
export async function setChainConfig(chain: string, chainConfig: ChainConfig): Promise<void> {
  const config = await loadConfig();
  config.chains[chain] = chainConfig;
  await saveConfig(config);
}

/** Get a custom chain definition by name. Returns null if not found. */
export async function getCustomChain(name: string): Promise<CustomChainDef | null> {
  const config = await loadConfig();
  return config.customChains?.[name] ?? null;
}

/** Persist a custom chain definition. */
export async function setCustomChain(name: string, def: CustomChainDef): Promise<void> {
  const config = await loadConfig();
  config.customChains = { ...(config.customChains ?? {}), [name]: def };
  await saveConfig(config);
}

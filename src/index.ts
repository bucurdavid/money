/**
 * index.ts — Main entry point for the @fast/money SDK
 *
 * Thin facade that delegates to registry, defaults, and adapters.
 */

import { loadConfig, setChainConfig, getChainConfig } from './config.js';
import { expandHome } from './utils.js';
import { loadKeyfile, scrubKeyFromError } from './keys.js';
import { detectChain, isValidAddress } from './detect.js';
import { MoneyError } from './errors.js';
import { getAdapter, evictAdapter, _resetAdapterCache } from './registry.js';
import { DEFAULT_CHAIN_CONFIGS, configKey, parseConfigKey, supportedChains } from './defaults.js';
import type {
  NetworkType,
  SetupOptions,
  TokenConfig,
  TokenInfo,
  SetupResult,
  ChainInfo,
  WalletInfo,
  BalanceResult,
  SendOptions,
  SendResult,
  FaucetResult,
  HistoryEntry,
  ChainConfig,
} from './types.js';

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type {
  NetworkType,
  SetupOptions,
  TokenInfo,
  SetupResult,
  ChainInfo,
  WalletInfo,
  BalanceResult,
  SendOptions,
  SendResult,
  FaucetResult,
  HistoryEntry,
  ChainConfig,
} from './types.js';

export type {
  MoneyConfig,
  ChainName,
  TokenConfig,
} from './types.js';

export { MoneyError } from './errors.js';
export type { MoneyErrorCode } from './errors.js';
export { _resetAdapterCache } from './registry.js';

// ─── SDK Object ───────────────────────────────────────────────────────────────

export const money = {
  async setup(chain: string, opts?: SetupOptions): Promise<SetupResult> {
    const network: NetworkType = opts?.network ?? 'testnet';
    const chainDefaults = DEFAULT_CHAIN_CONFIGS[chain];
    if (!chainDefaults) {
      throw new Error(
        `No default config for chain "${chain}". Supported chains: ${supportedChains().join(', ')}.`
      );
    }
    const defaults = chainDefaults[network];
    if (!defaults) {
      throw new Error(
        `No config for chain "${chain}" on network "${network}".`
      );
    }

    const key = configKey(chain, network);
    const existing = await getChainConfig(key);
    const rpc = opts?.rpc ?? existing?.rpc ?? defaults.rpc;
    const chainConfig: ChainConfig = existing
      ? { ...existing, rpc, network: defaults.network }
      : { ...defaults, rpc };

    await setChainConfig(key, chainConfig);
    evictAdapter(key);

    const adapter = await getAdapter(key);
    const keyfilePath = expandHome(chainConfig.keyfile);

    let address: string;
    try {
      const result = await adapter.setupWallet(keyfilePath);
      address = result.address;
    } catch (err) {
      throw scrubKeyFromError(err);
    }

    return { chain, address, network: chainConfig.network };
  },

  async chains(): Promise<ChainInfo[]> {
    const config = await loadConfig();
    const results: ChainInfo[] = [];

    for (const [key, chainConfig] of Object.entries(config.chains)) {
      const { chain } = parseConfigKey(key);
      const keyfilePath = expandHome(chainConfig.keyfile);

      let keyfileExists = false;
      try {
        await loadKeyfile(keyfilePath);
        keyfileExists = true;
      } catch { /* Keyfile missing or unreadable */ }

      if (!keyfileExists) {
        results.push({ chain: key, address: '', network: chainConfig.network, defaultToken: chainConfig.defaultToken, status: 'no-key' });
        continue;
      }

      let address = '';
      let status: ChainInfo['status'] = 'ready';
      try {
        const adapter = await getAdapter(key);
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        status = (msg.includes('not configured') || msg.includes('no-rpc')) ? 'no-rpc' : 'error';
      }

      results.push({ chain: key, address, network: chainConfig.network, defaultToken: chainConfig.defaultToken, status });
    }

    return results;
  },

  async wallets(): Promise<WalletInfo[]> {
    const config = await loadConfig();
    const results: WalletInfo[] = [];

    for (const [key, chainConfig] of Object.entries(config.chains)) {
      const keyfilePath = expandHome(chainConfig.keyfile);

      let adapter;
      try { adapter = await getAdapter(key); } catch { continue; }

      let address: string;
      try { const result = await adapter.setupWallet(keyfilePath); address = result.address; } catch { continue; }

      const balances: Record<string, string> = {};
      try {
        const bal = await adapter.getBalance(address, chainConfig.defaultToken);
        balances[bal.token] = bal.amount;
      } catch { /* RPC unavailable */ }

      results.push({ chain: key, address, balances });
    }

    return results;
  },

  async balance(chain?: string, token?: string): Promise<BalanceResult | BalanceResult[]> {
    if (chain) {
      // Try the exact key first, then fall back to bare chain name (testnet compat)
      let chainConfig = await getChainConfig(chain);
      let key = chain;
      if (!chainConfig) {
        throw new Error(`Chain "${chain}" is not configured. Run money.setup("${chain}") first.`);
      }
      const adapter = await getAdapter(key);
      const keyfilePath = expandHome(chainConfig.keyfile);
      const { address } = await adapter.setupWallet(keyfilePath);
      const resolvedToken = token ?? chainConfig.defaultToken;
      const bal = await adapter.getBalance(address, resolvedToken);
      return { chain: key, address, amount: bal.amount, token: bal.token };
    }

    const config = await loadConfig();
    const results: BalanceResult[] = [];
    for (const [key, chainConfig] of Object.entries(config.chains)) {
      let adapter;
      try { adapter = await getAdapter(key); } catch { continue; }
      const keyfilePath = expandHome(chainConfig.keyfile);
      let address: string;
      try { const result = await adapter.setupWallet(keyfilePath); address = result.address; } catch { continue; }
      const resolvedToken = token ?? chainConfig.defaultToken;
      try {
        const bal = await adapter.getBalance(address, resolvedToken);
        results.push({ chain: key, address, amount: bal.amount, token: bal.token });
      } catch { continue; }
    }
    return results;
  },

  async send(to: string, amount: number | string, opts?: SendOptions): Promise<SendResult> {
    const amountStr = String(amount);
    const amountNum = parseFloat(amountStr);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new MoneyError('TX_FAILED', `Invalid amount: "${amountStr}". Must be a positive number.`, { chain: opts?.chain ?? 'unknown' });
    }

    const config = await loadConfig();
    const configuredChains = Object.keys(config.chains);
    // For chain detection, use bare chain names from configured keys
    const bareChains = configuredChains.map(k => parseConfigKey(k).chain);
    const chain = opts?.chain ?? detectChain(to, bareChains);

    if (!chain) {
      throw new MoneyError('INVALID_ADDRESS', `Could not detect chain from address "${to}". Specify opts.chain explicitly.`, { details: { address: to } });
    }
    if (!isValidAddress(to, chain)) {
      throw new MoneyError('INVALID_ADDRESS', `Address "${to}" is not valid for chain "${chain}".`, { chain, details: { address: to } });
    }

    // Find the config key — prefer exact match, then bare chain name
    let key = chain;
    let chainConfig = config.chains[chain];
    if (!chainConfig) {
      // Check if there's a mainnet config
      const mainnetKey = `${chain}:mainnet`;
      if (config.chains[mainnetKey]) {
        key = mainnetKey;
        chainConfig = config.chains[mainnetKey];
      }
    }
    if (!chainConfig) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`, { chain });
    }

    const adapter = await getAdapter(key);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address: from } = await adapter.setupWallet(keyfilePath);
    const token = opts?.token ?? chainConfig.defaultToken;

    try {
      const bal = await adapter.getBalance(from, token);
      if (parseFloat(bal.amount) < parseFloat(amountStr)) {
        throw new MoneyError('INSUFFICIENT_BALANCE', `Need ${amount} ${token}, have ${bal.amount}`, { chain, details: { have: bal.amount, need: amountStr, token } });
      }
    } catch (err) {
      if (err instanceof MoneyError) throw err;
    }

    let result: { txHash: string; explorerUrl: string; fee: string };
    try {
      result = await adapter.send({ from, to, amount: amountStr, token, memo: opts?.memo, keyfile: keyfilePath });
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      const scrubbed = scrubKeyFromError(err);
      const msg = scrubbed instanceof Error ? scrubbed.message : String(scrubbed);
      throw new MoneyError('TX_FAILED', msg, { chain });
    }

    return { txHash: result.txHash, explorerUrl: result.explorerUrl, fee: result.fee, chain };
  },

  async faucet(chain: string): Promise<FaucetResult> {
    const chainConfig = await getChainConfig(chain);
    if (!chainConfig) throw new Error(`Chain "${chain}" is not configured. Run money.setup("${chain}") first.`);
    const adapter = await getAdapter(chain);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address } = await adapter.setupWallet(keyfilePath);
    const result = await adapter.faucet(address);
    return { chain, amount: result.amount, token: result.token, txHash: result.txHash };
  },

  async addToken(chain: string, name: string, token: TokenConfig): Promise<void> {
    // Find the config key for this chain — try bare name, then :mainnet
    const config = await loadConfig();
    let key: string | null = null;
    if (config.chains[chain]) {
      key = chain;
    } else {
      const mainnetKey = `${chain}:mainnet`;
      if (config.chains[mainnetKey]) {
        key = mainnetKey;
      }
    }
    if (!key) {
      throw new MoneyError(
        'CHAIN_NOT_CONFIGURED',
        `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`,
        { chain },
      );
    }
    const chainConfig = config.chains[key]!;
    chainConfig.tokens = { ...(chainConfig.tokens ?? {}), [name]: token };
    await setChainConfig(key, chainConfig);
    evictAdapter(key);
  },

  async tokens(chain?: string): Promise<TokenInfo[]> {
    const config = await loadConfig();
    const results: TokenInfo[] = [];

    for (const [key, chainConfig] of Object.entries(config.chains)) {
      const { chain: chainName } = parseConfigKey(key);
      // If a specific chain was requested, filter by bare chain name OR exact config key
      if (chain && chainName !== chain && key !== chain) continue;

      if (chainConfig.tokens) {
        for (const [name, tc] of Object.entries(chainConfig.tokens)) {
          results.push({
            chain: key,
            name,
            ...(tc.address ? { address: tc.address } : {}),
            ...(tc.mint ? { mint: tc.mint } : {}),
            decimals: tc.decimals ?? 6,
          });
        }
      }
    }

    return results;
  },

  async history(chain?: string, limit?: number): Promise<HistoryEntry[]> {
    const config = await loadConfig();
    const chains = chain ? [chain] : Object.keys(config.chains);
    const allEntries: HistoryEntry[] = [];

    for (const key of chains) {
      const chainConfig = config.chains[key];
      if (!chainConfig) continue;
      let adapter;
      try { adapter = await getAdapter(key); } catch { continue; }
      if (typeof adapter.getHistory !== 'function') continue;
      const keyfilePath = expandHome(chainConfig.keyfile);
      let address: string;
      try { const result = await adapter.setupWallet(keyfilePath); address = result.address; } catch { continue; }
      try { const entries = await adapter.getHistory(address, limit); allEntries.push(...entries); } catch { continue; }
    }

    allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (limit !== undefined && allEntries.length > limit) return allEntries.slice(0, limit);
    return allEntries;
  },

  detect(address: string): string | null {
    return detectChain(address, supportedChains());
  },
};

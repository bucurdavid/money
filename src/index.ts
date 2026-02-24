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
import { DEFAULT_CHAIN_CONFIGS } from './defaults.js';
import type {
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
  async setup(chain: string): Promise<SetupResult> {
    const defaults = DEFAULT_CHAIN_CONFIGS[chain];
    if (!defaults) {
      throw new Error(
        `No default config for chain "${chain}". Supported chains: ${Object.keys(DEFAULT_CHAIN_CONFIGS).join(', ')}.`
      );
    }

    const existing = await getChainConfig(chain);
    const chainConfig: ChainConfig = existing
      ? { ...existing, rpc: defaults.rpc, network: defaults.network }
      : { ...defaults };

    await setChainConfig(chain, chainConfig);
    evictAdapter(chain);

    const adapter = await getAdapter(chain);
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

    for (const [chain, chainConfig] of Object.entries(config.chains)) {
      const keyfilePath = expandHome(chainConfig.keyfile);

      let keyfileExists = false;
      try {
        await loadKeyfile(keyfilePath);
        keyfileExists = true;
      } catch { /* Keyfile missing or unreadable */ }

      if (!keyfileExists) {
        results.push({ chain, address: '', network: chainConfig.network, defaultToken: chainConfig.defaultToken, status: 'no-key' });
        continue;
      }

      let address = '';
      let status: ChainInfo['status'] = 'ready';
      try {
        const adapter = await getAdapter(chain);
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        status = (msg.includes('not configured') || msg.includes('no-rpc')) ? 'no-rpc' : 'error';
      }

      results.push({ chain, address, network: chainConfig.network, defaultToken: chainConfig.defaultToken, status });
    }

    return results;
  },

  async wallets(): Promise<WalletInfo[]> {
    const config = await loadConfig();
    const results: WalletInfo[] = [];

    for (const [chain, chainConfig] of Object.entries(config.chains)) {
      const keyfilePath = expandHome(chainConfig.keyfile);

      let adapter;
      try { adapter = await getAdapter(chain); } catch { continue; }

      let address: string;
      try { const result = await adapter.setupWallet(keyfilePath); address = result.address; } catch { continue; }

      const balances: Record<string, string> = {};
      try {
        const bal = await adapter.getBalance(address, chainConfig.defaultToken);
        balances[bal.token] = bal.amount;
      } catch { /* RPC unavailable */ }

      results.push({ chain, address, balances });
    }

    return results;
  },

  async balance(chain?: string, token?: string): Promise<BalanceResult | BalanceResult[]> {
    if (chain) {
      const chainConfig = await getChainConfig(chain);
      if (!chainConfig) throw new Error(`Chain "${chain}" is not configured. Run money.setup("${chain}") first.`);
      const adapter = await getAdapter(chain);
      const keyfilePath = expandHome(chainConfig.keyfile);
      const { address } = await adapter.setupWallet(keyfilePath);
      const resolvedToken = token ?? chainConfig.defaultToken;
      const bal = await adapter.getBalance(address, resolvedToken);
      return { chain, address, amount: bal.amount, token: bal.token };
    }

    const config = await loadConfig();
    const results: BalanceResult[] = [];
    for (const [c, chainConfig] of Object.entries(config.chains)) {
      let adapter;
      try { adapter = await getAdapter(c); } catch { continue; }
      const keyfilePath = expandHome(chainConfig.keyfile);
      let address: string;
      try { const result = await adapter.setupWallet(keyfilePath); address = result.address; } catch { continue; }
      const resolvedToken = token ?? chainConfig.defaultToken;
      try {
        const bal = await adapter.getBalance(address, resolvedToken);
        results.push({ chain: c, address, amount: bal.amount, token: bal.token });
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
    const chain = opts?.chain ?? detectChain(to, configuredChains);

    if (!chain) {
      throw new MoneyError('INVALID_ADDRESS', `Could not detect chain from address "${to}". Specify opts.chain explicitly.`, { details: { address: to } });
    }
    if (!isValidAddress(to, chain)) {
      throw new MoneyError('INVALID_ADDRESS', `Address "${to}" is not valid for chain "${chain}".`, { chain, details: { address: to } });
    }

    const chainConfig = config.chains[chain];
    if (!chainConfig) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`, { chain });
    }

    const adapter = await getAdapter(chain);
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

  async history(chain?: string, limit?: number): Promise<HistoryEntry[]> {
    const config = await loadConfig();
    const chains = chain ? [chain] : Object.keys(config.chains);
    const allEntries: HistoryEntry[] = [];

    for (const c of chains) {
      const chainConfig = config.chains[c];
      if (!chainConfig) continue;
      let adapter;
      try { adapter = await getAdapter(c); } catch { continue; }
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
    return detectChain(address, Object.keys(DEFAULT_CHAIN_CONFIGS));
  },
};

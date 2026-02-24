/**
 * index.ts — Main entry point for the @fast/money SDK
 */

import { loadConfig, setChainConfig, getChainConfig } from './config.js';
import { expandHome } from './utils.js';
import { loadKeyfile, scrubKeyFromError } from './keys.js';
import { detectChain, isValidAddress } from './detect.js';
import { MoneyError } from './errors.js';
import { getAdapter, evictAdapter, _resetAdapterCache } from './registry.js';
import { DEFAULT_CHAIN_CONFIGS, DEFAULT_ALIASES, configKey, parseConfigKey, supportedChains } from './defaults.js';
import { getAlias, setAlias, getAliases, seedAliases } from './aliases.js';
import { appendHistory, readHistory } from './history.js';
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
  ChainName,
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve a bare chain name to its config key and ChainConfig.
 * Tries exact match first, then "<chain>:mainnet".
 */
function resolveChainKey(
  chain: string,
  chains: Record<string, ChainConfig>,
): { key: string; chainConfig: ChainConfig } | null {
  if (chains[chain]) return { key: chain, chainConfig: chains[chain]! };
  const mainnetKey = `${chain}:mainnet`;
  if (chains[mainnetKey]) return { key: mainnetKey, chainConfig: chains[mainnetKey]! };
  return null;
}

// ─── SDK Object ───────────────────────────────────────────────────────────────

export const money = {

  async setup(chain: string, opts?: SetupOptions): Promise<SetupResult> {
    const network: NetworkType = opts?.network ?? 'testnet';
    const chainDefaults = DEFAULT_CHAIN_CONFIGS[chain];
    if (!chainDefaults) {
      throw new MoneyError(
        'CHAIN_NOT_CONFIGURED',
        `No default config for chain "${chain}". Supported chains: ${supportedChains().join(', ')}.`,
        { chain },
      );
    }
    const defaults = chainDefaults[network];
    if (!defaults) {
      throw new MoneyError(
        'CHAIN_NOT_CONFIGURED',
        `No config for chain "${chain}" on network "${network}".`,
        { chain },
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

    // Seed default aliases (e.g. USDC) for this chain+network — idempotent
    const chainName = chain as ChainName;
    await seedAliases(key, DEFAULT_ALIASES[chainName]?.[network]);

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
      const config = await loadConfig();
      const resolved = resolveChainKey(chain, config.chains);
      if (!resolved) {
        throw new MoneyError(
          'CHAIN_NOT_CONFIGURED',
          `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`,
          { chain },
        );
      }
      const { key, chainConfig } = resolved;
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
    // Deduplicate bare chain names (both testnet + mainnet may be configured)
    const bareChains = [...new Set(configuredChains.map(k => parseConfigKey(k).chain))];
    const chain = opts?.chain ?? detectChain(to, bareChains);

    if (!chain) {
      throw new MoneyError('INVALID_ADDRESS', `Could not detect chain from address "${to}". Specify opts.chain explicitly.`, { details: { address: to } });
    }
    if (!isValidAddress(to, chain)) {
      throw new MoneyError('INVALID_ADDRESS', `Address "${to}" is not valid for chain "${chain}".`, { chain, details: { address: to } });
    }

    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`, { chain });
    }
    const { key, chainConfig } = resolved;

    const adapter = await getAdapter(key);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address: from } = await adapter.setupWallet(keyfilePath);
    const token = opts?.token ?? chainConfig.defaultToken;

    // Best-effort pre-flight balance check. parseFloat may lose precision for
    // amounts with >15 significant digits (e.g. 18-decimal tokens). The RPC
    // layer enforces the real constraint — this check only provides a cleaner
    // error message in the common case.
    try {
      const bal = await adapter.getBalance(from, token);
      if (parseFloat(bal.amount) < parseFloat(amountStr)) {
        throw new MoneyError('INSUFFICIENT_BALANCE', `Need ${amount} ${token}, have ${bal.amount}`, { chain, details: { have: bal.amount, need: amountStr, token } });
      }
    } catch (err) {
      // Non-MoneyError (e.g. RPC timeout) is intentionally swallowed — best-effort
      // only. The send() call below will surface the real error if the RPC is down.
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

    // Record successful send in history.csv
    await appendHistory({
      ts: new Date().toISOString(),
      chain: key,
      to,
      amount: amountStr,
      token,
      txHash: result.txHash,
    });

    return { txHash: result.txHash, explorerUrl: result.explorerUrl, fee: result.fee, chain };
  },

  async faucet(chain: string): Promise<FaucetResult> {
    const chainConfig = await getChainConfig(chain);
    if (!chainConfig) throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`, { chain });
    const adapter = await getAdapter(chain);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address } = await adapter.setupWallet(keyfilePath);
    const result = await adapter.faucet(address);
    return { chain, amount: result.amount, token: result.token, txHash: result.txHash };
  },

  async alias(chain: string, name: string, config?: TokenConfig): Promise<TokenInfo | null> {
    const config2 = await loadConfig();
    const resolved = resolveChainKey(chain, config2.chains);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`, { chain });
    }
    const { key } = resolved;
    if (config !== undefined) {
      await setAlias(key, name, config);
      return null;
    }
    return getAlias(key, name);
  },

  async aliases(chain: string): Promise<TokenInfo[]> {
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) return [];
    return getAliases(resolved.key);
  },

  async history(chain?: string, limit?: number): Promise<HistoryEntry[]> {
    return readHistory(chain, limit);
  },

  detect(address: string): string | null {
    return detectChain(address, supportedChains());
  },
};

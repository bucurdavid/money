/**
 * index.ts — Main entry point for the money SDK
 */

import { loadConfig, setChainConfig, getChainConfig } from './config.js';
import { expandHome, compareDecimalStrings } from './utils.js';
import { loadKeyfile } from './keys.js';
import { identifyChains, isValidAddress } from './detect.js';
import { MoneyError } from './errors.js';
import { getAdapter, evictAdapter, _resetAdapterCache } from './registry.js';
import { DEFAULT_CHAIN_CONFIGS, configKey, parseConfigKey, supportedChains } from './defaults.js';
import { getAlias, setAlias, getAliases } from './aliases.js';
import { appendHistory, readHistory } from './history.js';
import type {
  NetworkType,
  SetupParams,
  BalanceParams,
  SendParams,
  FaucetParams,
  IdentifyChainsParams,
  GetTokenParams,
  RegisterTokenParams,
  TokensParams,
  HistoryParams,
  TokenConfig,
  TokenInfo,
  SetupResult,
  ChainStatus,
  StatusResult,
  BalanceResult,
  SendResult,
  FaucetResult,
  IdentifyChainsResult,
  TokensResult,
  HistoryResult,
  HistoryEntry,
  ChainConfig,
} from './types.js';

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type {
  NetworkType,
  SetupParams,
  BalanceParams,
  SendParams,
  FaucetParams,
  IdentifyChainsParams,
  GetTokenParams,
  RegisterTokenParams,
  TokensParams,
  HistoryParams,
  TokenInfo,
  SetupResult,
  ChainStatus,
  StatusResult,
  BalanceResult,
  SendResult,
  FaucetResult,
  IdentifyChainsResult,
  TokensResult,
  HistoryResult,
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

  async setup(params: SetupParams): Promise<SetupResult> {
    const { chain, network: networkOpt, rpc: rpcOpt } = params;
    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.setup({ chain: "fast" })',
      });
    }

    const network: NetworkType = networkOpt ?? 'testnet';
    const chainDefaults = DEFAULT_CHAIN_CONFIGS[chain];
    if (!chainDefaults) {
      throw new MoneyError(
        'CHAIN_NOT_CONFIGURED',
        `No default config for chain "${chain}". Supported chains: ${supportedChains().join(', ')}.`,
        { chain, note: `Supported chains: ${supportedChains().join(', ')}.\n  await money.setup({ chain: "fast" })` },
      );
    }
    const defaults = chainDefaults[network];
    if (!defaults) {
      throw new MoneyError(
        'CHAIN_NOT_CONFIGURED',
        `No config for chain "${chain}" on network "${network}".`,
        { chain, note: `Use network "testnet" or "mainnet":\n  await money.setup({ chain: "${chain}", network: "testnet" })` },
      );
    }

    const key = configKey(chain, network);
    const existing = await getChainConfig(key);
    const rpc = rpcOpt ?? existing?.rpc ?? defaults.rpc;
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
      throw err;
    }

    const note = network === 'testnet'
      ? `Fund this wallet:\n  await money.faucet({ chain: "${chain}" })`
      : '';

    return { chain, address, network: chainConfig.network, note };
  },

  async status(): Promise<StatusResult> {
    const config = await loadConfig();
    const results: ChainStatus[] = [];

    for (const [key, chainConfig] of Object.entries(config.chains)) {
      const { chain } = parseConfigKey(key);
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
      let status: ChainStatus['status'] = 'ready';
      try {
        const adapter = await getAdapter(key);
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch (err) {
        status = (err instanceof MoneyError && err.code === 'CHAIN_NOT_CONFIGURED')
          ? 'no-rpc'
          : 'error';
      }

      let balance: string | undefined;
      if (status === 'ready' && address) {
        try {
          const adapter = await getAdapter(key);
          const bal = await adapter.getBalance(address, chainConfig.defaultToken);
          balance = bal.amount;
        } catch { /* best-effort — ignore RPC errors */ }
      }

      results.push({ chain, address, network: chainConfig.network, defaultToken: chainConfig.defaultToken, status, balance });
    }

    return { entries: results, note: '' };
  },

  async balance(params: BalanceParams): Promise<BalanceResult> {
    const { chain, token: tokenOpt } = params;
    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.balance({ chain: "fast" })',
      });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) {
      throw new MoneyError(
        'CHAIN_NOT_CONFIGURED',
        `Chain "${chain}" is not configured.`,
        { chain, note: `Run setup first:\n  await money.setup({ chain: "${chain}" })` },
      );
    }
    const { key, chainConfig } = resolved;
    const adapter = await getAdapter(key);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address } = await adapter.setupWallet(keyfilePath);
    const token = (!tokenOpt || tokenOpt === 'native') ? chainConfig.defaultToken : tokenOpt;
    const bal = await adapter.getBalance(address, token);
    const { chain: balChain, network: balNetwork } = parseConfigKey(key);

    let note = '';
    if (bal.amount === '0' && chainConfig.network === 'testnet') {
      note = `Balance is 0. Get testnet tokens:\n  await money.faucet({ chain: "${chain}" })`;
    }

    return { chain: balChain, network: balNetwork as NetworkType, address, amount: bal.amount, token: bal.token, note };
  },

  async send(params: SendParams): Promise<SendResult> {
    const { to, amount: amountRaw, chain, token: tokenOpt } = params;

    if (!to) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: to', {
        note: 'Provide a recipient address:\n  await money.send({ to: "set1...", amount: "1", chain: "fast" })',
      });
    }
    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.send({ to, amount, chain: "fast" })',
      });
    }
    if (!amountRaw) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: amount', {
        note: 'Provide an amount:\n  await money.send({ to, amount: "1", chain: "fast" })',
      });
    }

    const amountStr = String(amountRaw);
    const amountNum = parseFloat(amountStr);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new MoneyError('TX_FAILED', `Invalid amount: "${amountStr}". Must be a positive number.`, { chain, note: `Amount must be a positive number:\n  await money.send({ to, amount: "1", chain: "${chain}" })` });
    }

    if (!isValidAddress(to, chain)) {
      throw new MoneyError('INVALID_ADDRESS', `Address "${to}" is not valid for chain "${chain}".`, { chain, details: { address: to }, note: `Verify the address format. Use identifyChains to check:\n  money.identifyChains({ address: "${to}" })` });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key, chainConfig } = resolved;

    const adapter = await getAdapter(key);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address: from } = await adapter.setupWallet(keyfilePath);
    const token = (!tokenOpt || tokenOpt === 'native') ? chainConfig.defaultToken : tokenOpt;

    // Best-effort pre-flight balance check.
    try {
      const bal = await adapter.getBalance(from, token);
      if (compareDecimalStrings(bal.amount, amountStr) < 0) {
        const insufficientNote = chainConfig.network === 'testnet'
          ? `Testnet: await money.faucet({ chain: "${chain}" })\nOr reduce the amount.`
          : 'Fund the wallet or reduce the amount.';
        throw new MoneyError('INSUFFICIENT_BALANCE', `Need ${amountRaw} ${token}, have ${bal.amount}`, {
          chain,
          details: { have: bal.amount, need: amountStr, token },
          note: insufficientNote,
        });
      }
    } catch (err) {
      if (err instanceof MoneyError) throw err;
    }

    let result: { txHash: string; explorerUrl: string; fee: string };
    try {
      result = await adapter.send({ from, to, amount: amountStr, token, keyfile: keyfilePath });
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new MoneyError('TX_FAILED', msg, { chain, note: `Wait 5 seconds, then retry:\n  await money.send({ to: "${to}", amount: "${amountStr}", chain: "${chain}" })` });
    }

    // Record successful send in history.csv
    const { chain: sentChain, network: sentNetwork } = parseConfigKey(key);
    await appendHistory({
      ts: new Date().toISOString(),
      chain: sentChain,
      network: sentNetwork,
      to,
      amount: amountStr,
      token,
      txHash: result.txHash,
    });

    return { ...result, chain: sentChain, network: sentNetwork as NetworkType, note: '' };
  },

  async faucet(params: FaucetParams): Promise<FaucetResult> {
    const { chain } = params;
    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.faucet({ chain: "fast" })',
      });
    }

    const chainConfig = await getChainConfig(chain);
    if (!chainConfig) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const adapter = await getAdapter(chain);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address } = await adapter.setupWallet(keyfilePath);
    const result = await adapter.faucet(address);
    const { chain: faucetChain, network: faucetNetwork } = parseConfigKey(chain);
    return {
      chain: faucetChain,
      network: faucetNetwork as NetworkType,
      amount: result.amount,
      token: result.token,
      txHash: result.txHash,
      note: `Check balance:\n  await money.balance({ chain: "${chain}" })`,
    };
  },

  async getToken(params: GetTokenParams): Promise<TokenInfo | null> {
    const { chain, name } = params;
    if (!chain || !name) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required params: chain and name', {
        note: 'Provide chain and name:\n  await money.getToken({ chain: "fast", name: "MYTOKEN" })',
      });
    }
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key } = resolved;
    return getAlias(key, name);
  },

  async registerToken(params: RegisterTokenParams): Promise<void> {
    const { chain, name, ...tokenConfig } = params;
    if (!chain || !name) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required params: chain and name', {
        note: 'Provide chain and name:\n  await money.registerToken({ chain: "fast", name: "MYTOKEN", address: "0x...", decimals: 18 })',
      });
    }
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key } = resolved;
    await setAlias(key, name, tokenConfig as TokenConfig);
  },

  async tokens(params: TokensParams): Promise<TokensResult> {
    const { chain } = params;
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains);
    if (!resolved) return { tokens: [], note: '' };
    const aliasResults = await getAliases(resolved.key);
    return { tokens: aliasResults, note: '' };
  },

  async history(params?: HistoryParams): Promise<HistoryResult> {
    const results = await readHistory(params);
    return { entries: results, note: '' };
  },

  identifyChains(params: IdentifyChainsParams): IdentifyChainsResult {
    const { address } = params;
    const chains = identifyChains(address);

    let note: string;
    if (chains.length > 1) {
      note = 'Multiple chains use this address format. Specify chain explicitly.';
    } else if (chains.length === 0) {
      note = 'Address format not recognized. Supported formats:\n  Fast: set1... (bech32m)\n  EVM: 0x... (40 hex chars)\n  Solana: base58 (32-44 chars)';
    } else {
      note = '';
    }

    return { chains, note };
  },
};

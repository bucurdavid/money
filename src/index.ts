/**
 * index.ts — Main entry point for the @fast/money SDK
 *
 * Exports the `money` object with all public API methods, plus re-exports
 * all types from types.ts for consumer convenience.
 */

import os from 'os';
import path from 'path';

import { loadConfig, setChainConfig, getChainConfig } from './config.js';
import { loadKeyfile, scrubKeyFromError } from './keys.js';
import { detectChain, isValidAddress } from './detect.js';
import { MoneyError } from './errors.js';
import type { MoneyErrorCode } from './errors.js';
import { createFastAdapter } from './adapters/fast.js';
import { createEvmAdapter } from './adapters/evm.js';
import { createSolanaAdapter } from './adapters/solana.js';
import type { ChainAdapter } from './adapters/adapter.js';
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

// ─── Adapter registry ─────────────────────────────────────────────────────────

const adapterCache = new Map<string, ChainAdapter>();

/** EVM chain names — they share the same adapter type */
const EVM_CHAINS = ['base', 'ethereum', 'arbitrum'];

/**
 * Expand `~` in a path string.
 */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Lazily create and cache a ChainAdapter for the given chain.
 * Throws if the chain is not configured or not yet supported.
 */
async function getAdapter(chain: string): Promise<ChainAdapter> {
  if (adapterCache.has(chain)) {
    return adapterCache.get(chain)!;
  }

  const chainConfig = await getChainConfig(chain);
  if (!chainConfig) {
    throw new MoneyError('CHAIN_NOT_CONFIGURED',
      `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`,
      { chain },
    );
  }

  let adapter: ChainAdapter;

  if (chain === 'fast') {
    adapter = createFastAdapter(chainConfig.rpc);
  } else if (EVM_CHAINS.includes(chain)) {
    const explorerUrls: Record<string, string> = {
      base: 'https://sepolia.basescan.org',
      ethereum: 'https://sepolia.etherscan.io',
      arbitrum: 'https://sepolia.arbiscan.io',
    };
    const tokens: Record<string, { address: string; decimals: number }> = {};
    if (chainConfig.tokens) {
      for (const [name, tc] of Object.entries(chainConfig.tokens)) {
        if (tc.address) tokens[name] = { address: tc.address, decimals: tc.decimals ?? 6 };
      }
    }
    adapter = createEvmAdapter(chain, chainConfig.rpc, explorerUrls[chain] ?? '', tokens);
  } else if (chain === 'solana') {
    const tokens: Record<string, { mint: string; decimals: number }> = {};
    if (chainConfig.tokens) {
      for (const [name, tc] of Object.entries(chainConfig.tokens)) {
        if (tc.mint) tokens[name] = { mint: tc.mint, decimals: tc.decimals ?? 6 };
      }
    }
    adapter = createSolanaAdapter(chainConfig.rpc, tokens);
  } else {
    throw new Error(`Unknown chain "${chain}".`);
  }

  adapterCache.set(chain, adapter);
  return adapter;
}

// ─── Default chain configs ────────────────────────────────────────────────────

const DEFAULT_CHAIN_CONFIGS: Record<string, ChainConfig> = {
  fast: {
    rpc: 'https://proxy.fastset.xyz',
    keyfile: '~/.money/keys/fast.json',
    network: 'testnet',
    defaultToken: 'SET',
  },
  base: {
    rpc: 'https://sepolia.base.org',
    keyfile: '~/.money/keys/evm.json',
    network: 'sepolia',
    defaultToken: 'USDC',
    tokens: {
      USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
    },
  },
  ethereum: {
    rpc: 'https://rpc.sepolia.org',
    keyfile: '~/.money/keys/evm.json',
    network: 'sepolia',
    defaultToken: 'USDC',
    tokens: {
      USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
    },
  },
  arbitrum: {
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    keyfile: '~/.money/keys/evm.json',
    network: 'sepolia',
    defaultToken: 'USDC',
    tokens: {
      USDC: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
    },
  },
  solana: {
    rpc: 'https://api.devnet.solana.com',
    keyfile: '~/.money/keys/solana.json',
    network: 'devnet',
    defaultToken: 'USDC',
    tokens: {
      USDC: { mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' },
    },
  },
};

// ─── SDK Object ───────────────────────────────────────────────────────────────

export const money = {
  /**
   * Set up a chain: save its default config and generate (or load) a wallet.
   * Returns the chain name, wallet address, and network.
   */
  async setup(chain: string): Promise<SetupResult> {
    const defaults = DEFAULT_CHAIN_CONFIGS[chain];
    if (!defaults) {
      throw new Error(
        `No default config for chain "${chain}". ` +
        `Supported chains: ${Object.keys(DEFAULT_CHAIN_CONFIGS).join(', ')}.`
      );
    }

    // Defaults win for critical fields (rpc, network), existing wins for user customizations
    const existing = await getChainConfig(chain);
    const chainConfig: ChainConfig = existing
      ? { ...existing, rpc: defaults.rpc, network: defaults.network }
      : { ...defaults };

    await setChainConfig(chain, chainConfig);

    // Evict cached adapter so it picks up the new config
    adapterCache.delete(chain);

    const adapter = await getAdapter(chain);
    const keyfilePath = expandHome(chainConfig.keyfile);

    let address: string;
    try {
      const result = await adapter.setupWallet(keyfilePath);
      address = result.address;
    } catch (err) {
      throw scrubKeyFromError(err);
    }

    return {
      chain,
      address,
      network: chainConfig.network,
    };
  },

  /**
   * List all configured chains with their status and wallet address.
   */
  async chains(): Promise<ChainInfo[]> {
    const config = await loadConfig();
    const results: ChainInfo[] = [];

    for (const [chain, chainConfig] of Object.entries(config.chains)) {
      const keyfilePath = expandHome(chainConfig.keyfile);

      // Check keyfile existence
      let keyfileExists = false;
      try {
        await loadKeyfile(keyfilePath);
        keyfileExists = true;
      } catch {
        // Keyfile missing or unreadable
      }

      if (!keyfileExists) {
        results.push({
          chain,
          address: '',
          network: chainConfig.network,
          defaultToken: chainConfig.defaultToken,
          status: 'no-key',
        });
        continue;
      }

      // Try to get address via adapter
      let address = '';
      let status: ChainInfo['status'] = 'ready';
      try {
        const adapter = await getAdapter(chain);
        // setupWallet is idempotent: loads existing key, returns address
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('not yet implemented') || msg.includes('Unknown chain')) {
          status = 'error';
        } else if (msg.includes('not configured') || msg.includes('no-rpc')) {
          status = 'no-rpc';
        } else {
          status = 'error';
        }
      }

      results.push({
        chain,
        address,
        network: chainConfig.network,
        defaultToken: chainConfig.defaultToken,
        status,
      });
    }

    return results;
  },

  /**
   * Return wallet info (balances) for all configured chains.
   */
  async wallets(): Promise<WalletInfo[]> {
    const config = await loadConfig();
    const results: WalletInfo[] = [];

    for (const [chain, chainConfig] of Object.entries(config.chains)) {
      const keyfilePath = expandHome(chainConfig.keyfile);

      let adapter: ChainAdapter;
      try {
        adapter = await getAdapter(chain);
      } catch {
        continue; // Skip chains without adapters (not yet implemented)
      }

      let address: string;
      try {
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch {
        continue;
      }

      const balances: Record<string, string> = {};
      try {
        const bal = await adapter.getBalance(address, chainConfig.defaultToken);
        balances[bal.token] = bal.amount;
      } catch {
        // Continue with empty balances if RPC unavailable
      }

      results.push({ chain, address, balances });
    }

    return results;
  },

  /**
   * Get balance for a specific chain+token, or all configured chains.
   * Returns a single BalanceResult when chain is specified, or an array.
   */
  async balance(
    chain?: string,
    token?: string,
  ): Promise<BalanceResult | BalanceResult[]> {
    if (chain) {
      // Single chain
      const chainConfig = await getChainConfig(chain);
      if (!chainConfig) {
        throw new Error(
          `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`
        );
      }
      const adapter = await getAdapter(chain);
      const keyfilePath = expandHome(chainConfig.keyfile);
      const { address } = await adapter.setupWallet(keyfilePath);
      const resolvedToken = token ?? chainConfig.defaultToken;
      const bal = await adapter.getBalance(address, resolvedToken);
      return {
        chain,
        address,
        amount: bal.amount,
        token: bal.token,
      };
    }

    // All chains
    const config = await loadConfig();
    const results: BalanceResult[] = [];

    for (const [c, chainConfig] of Object.entries(config.chains)) {
      let adapter: ChainAdapter;
      try {
        adapter = await getAdapter(c);
      } catch {
        continue;
      }

      const keyfilePath = expandHome(chainConfig.keyfile);
      let address: string;
      try {
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch {
        continue;
      }

      const resolvedToken = token ?? chainConfig.defaultToken;
      try {
        const bal = await adapter.getBalance(address, resolvedToken);
        results.push({ chain: c, address, amount: bal.amount, token: bal.token });
      } catch {
        continue;
      }
    }

    return results;
  },

  /**
   * Send tokens to an address.
   * Auto-detects chain from the recipient address if not provided in opts.
   */
  async send(
    to: string,
    amount: number | string,
    opts?: SendOptions,
  ): Promise<SendResult> {
    // Validate amount
    const amountStr = String(amount);
    const amountNum = parseFloat(amountStr);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new MoneyError('TX_FAILED',
        `Invalid amount: "${amountStr}". Must be a positive number.`,
        { chain: opts?.chain ?? 'unknown' },
      );
    }

    const config = await loadConfig();
    const configuredChains = Object.keys(config.chains);

    // Determine chain
    const chain =
      opts?.chain ?? detectChain(to, configuredChains);

    if (!chain) {
      throw new MoneyError('INVALID_ADDRESS',
        `Could not detect chain from address "${to}". Specify opts.chain explicitly.`,
        { details: { address: to } },
      );
    }

    // Validate address format for detected chain
    if (!isValidAddress(to, chain)) {
      throw new MoneyError('INVALID_ADDRESS',
        `Address "${to}" is not valid for chain "${chain}".`,
        { chain, details: { address: to } },
      );
    }

    const chainConfig = config.chains[chain];
    if (!chainConfig) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED',
        `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`,
        { chain },
      );
    }

    const adapter = await getAdapter(chain);
    const keyfilePath = expandHome(chainConfig.keyfile);

    // Derive sender address from keyfile
    const { address: from } = await adapter.setupWallet(keyfilePath);
    const token = opts?.token ?? chainConfig.defaultToken;

    // Pre-send balance check
    try {
      const bal = await adapter.getBalance(from, token);
      if (parseFloat(bal.amount) < parseFloat(String(amount))) {
        throw new MoneyError('INSUFFICIENT_BALANCE',
          `Need ${amount} ${token}, have ${bal.amount}`,
          { chain, details: { have: bal.amount, need: String(amount), token } },
        );
      }
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      // If balance check itself fails, proceed with send anyway
    }

    let result: { txHash: string; explorerUrl: string; fee: string };
    try {
      result = await adapter.send({
        from,
        to,
        amount: String(amount),
        token,
        memo: opts?.memo,
        keyfile: keyfilePath,
      });
    } catch (err) {
      if (err instanceof MoneyError) throw err;
      const scrubbed = scrubKeyFromError(err);
      const msg = scrubbed instanceof Error ? scrubbed.message : String(scrubbed);
      throw new MoneyError('TX_FAILED', msg, { chain });
    }

    return {
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      fee: result.fee,
      chain,
    };
  },

  /**
   * Request testnet tokens from the chain's faucet.
   */
  async faucet(chain: string): Promise<FaucetResult> {
    const chainConfig = await getChainConfig(chain);
    if (!chainConfig) {
      throw new Error(
        `Chain "${chain}" is not configured. Run money.setup("${chain}") first.`
      );
    }

    const adapter = await getAdapter(chain);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address } = await adapter.setupWallet(keyfilePath);

    const result = await adapter.faucet(address);

    return {
      chain,
      amount: result.amount,
      token: result.token,
      txHash: result.txHash,
    };
  },

  /**
   * Get transaction history for a chain (or all chains if chain is omitted).
   */
  async history(chain?: string, limit?: number): Promise<HistoryEntry[]> {
    const config = await loadConfig();

    const chains = chain
      ? [chain]
      : Object.keys(config.chains);

    const allEntries: HistoryEntry[] = [];

    for (const c of chains) {
      const chainConfig = config.chains[c];
      if (!chainConfig) continue;

      let adapter: ChainAdapter;
      try {
        adapter = await getAdapter(c);
      } catch {
        continue;
      }

      if (typeof adapter.getHistory !== 'function') {
        continue; // Chain adapter doesn't support history
      }

      const keyfilePath = expandHome(chainConfig.keyfile);
      let address: string;
      try {
        const result = await adapter.setupWallet(keyfilePath);
        address = result.address;
      } catch {
        continue;
      }

      try {
        const entries = await adapter.getHistory(address, limit);
        allEntries.push(...entries);
      } catch {
        continue;
      }
    }

    // Sort by timestamp descending (most recent first)
    allEntries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // If a limit was requested and we fetched multiple chains, trim
    if (limit !== undefined && allEntries.length > limit) {
      return allEntries.slice(0, limit);
    }

    return allEntries;
  },

  /**
   * Detect which chain an address belongs to.
   * Returns the chain name or null if unrecognized.
   */
  detect(address: string): string | null {
    // Use all known chain names as configured context
    return detectChain(address, Object.keys(DEFAULT_CHAIN_CONFIGS));
  },
};

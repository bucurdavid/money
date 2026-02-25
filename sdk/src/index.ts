/**
 * index.ts — Main entry point for the money SDK
 */

import { loadConfig, setChainConfig, getChainConfig, getCustomChain, setCustomChain } from './config.js';
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
  RegisterEvmChainParams,
  ReadContractParams,
  ReadContractResult,
  WriteContractParams,
  WriteContractResult,
  FetchContractInterfaceParams,
  FetchContractInterfaceResult,
  ParseUnitsParams,
  FormatUnitsParams,
  CustomChainDef,
} from './types.js';

import { parseUnits, formatUnits } from 'viem';

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
  ReadContractParams,
  ReadContractResult,
  WriteContractParams,
  WriteContractResult,
  FetchContractInterfaceParams,
  FetchContractInterfaceResult,
  ParseUnitsParams,
  FormatUnitsParams,
  RegisterEvmChainParams,
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
 * If network is provided, builds exact key via configKey(). Otherwise uses bare chain name.
 */
function resolveChainKey(
  chain: string,
  chains: Record<string, ChainConfig>,
  network?: NetworkType,
): { key: string; chainConfig: ChainConfig } | null {
  const key = network ? configKey(chain, network) : chain;
  if (chains[key]) return { key, chainConfig: chains[key]! };
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
    let defaults: ChainConfig | undefined;

    if (chainDefaults) {
      defaults = chainDefaults[network];
      if (!defaults) {
        throw new MoneyError(
          'CHAIN_NOT_CONFIGURED',
          `No config for chain "${chain}" on network "${network}".`,
          { chain, note: `Use network "testnet" or "mainnet":\n  await money.setup({ chain: "${chain}", network: "testnet" })` },
        );
      }
    } else {
      // Check if this is a registered custom chain
      const customDef: CustomChainDef | null = await getCustomChain(chain);
      if (!customDef) {
        throw new MoneyError(
          'CHAIN_NOT_CONFIGURED',
          `No default config for chain "${chain}". Supported chains: ${supportedChains().join(', ')}. Or register a custom chain:\n  await money.registerEvmChain({ chain: "${chain}", chainId: ..., rpc: "..." })`,
          { chain, note: `Supported chains: ${supportedChains().join(', ')}.\n  await money.registerEvmChain({ chain: "${chain}", chainId: ..., rpc: "..." })` },
        );
      }
      // For custom chains, the config was already written by registerEvmChain — load it
      const key = configKey(chain, network);
      const existing = await getChainConfig(key);
      if (!existing) {
        throw new MoneyError(
          'CHAIN_NOT_CONFIGURED',
          `Custom chain "${chain}" is registered but not configured for network "${network}". Register it for this network first.`,
          { chain, note: `Register for ${network}:\n  await money.registerEvmChain({ chain: "${chain}", chainId: ${customDef.chainId}, rpc: "...", network: "${network}" })` },
        );
      }
      defaults = existing;
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
    } catch (err: unknown) {
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
      } catch (err: unknown) {
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
    const { chain, network, token: tokenOpt } = params;
    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.balance({ chain: "fast" })',
      });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
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
    const { to, amount: amountRaw, chain, network, token: tokenOpt } = params;

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

    if (!await isValidAddress(to, chain)) {
      throw new MoneyError('INVALID_ADDRESS', `Address "${to}" is not valid for chain "${chain}".`, { chain, details: { address: to }, note: `Verify the address format. Use identifyChains to check:\n  money.identifyChains({ address: "${to}" })` });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
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
    } catch (err: unknown) {
      if (err instanceof MoneyError) throw err;
    }

    let result: { txHash: string; explorerUrl: string; fee: string };
    try {
      result = await adapter.send({ from, to, amount: amountStr, token, keyfile: keyfilePath });
    } catch (err: unknown) {
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
    const { chain, network } = params;
    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.faucet({ chain: "fast" })',
      });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key, chainConfig } = resolved;
    const adapter = await getAdapter(key);
    const keyfilePath = expandHome(chainConfig.keyfile);
    const { address } = await adapter.setupWallet(keyfilePath);
    const result = await adapter.faucet(address);
    const { chain: faucetChain, network: faucetNetwork } = parseConfigKey(key);
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
    const { chain, network, name } = params;
    if (!chain || !name) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required params: chain and name', {
        note: 'Provide chain and name:\n  await money.getToken({ chain: "fast", name: "MYTOKEN" })',
      });
    }
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
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
    const { chain, network, name, ...tokenConfig } = params;
    if (!chain || !name) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required params: chain and name', {
        note: 'Provide chain and name:\n  await money.registerToken({ chain: "fast", name: "MYTOKEN", address: "0x...", decimals: 18 })',
      });
    }
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
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
    const { chain, network } = params;
    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
    if (!resolved) return { tokens: [], note: '' };
    const aliasResults = await getAliases(resolved.key);
    return { tokens: aliasResults, note: '' };
  },

  async history(params?: HistoryParams): Promise<HistoryResult> {
    const results = await readHistory(params);
    return { entries: results, note: '' };
  },

  async identifyChains(params: IdentifyChainsParams): Promise<IdentifyChainsResult> {
    const { address } = params;
    const chains = await identifyChains(address);

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

  async registerEvmChain(params: RegisterEvmChainParams): Promise<void> {
    const { chain, chainId, rpc, explorer, defaultToken, network: networkOpt } = params;

    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.registerEvmChain({ chain: "polygon", chainId: 137, rpc: "https://polygon-rpc.com" })',
      });
    }
    if (!chainId) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chainId', {
        note: 'Provide the EVM chain ID:\n  await money.registerEvmChain({ chain: "polygon", chainId: 137, rpc: "https://polygon-rpc.com" })',
      });
    }
    if (!rpc) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: rpc', {
        note: 'Provide an RPC URL:\n  await money.registerEvmChain({ chain: "polygon", chainId: 137, rpc: "https://polygon-rpc.com" })',
      });
    }

    // Reject built-in chain names
    if (supportedChains().includes(chain)) {
      throw new MoneyError('INVALID_PARAMS', `"${chain}" is a built-in chain and cannot be overridden. Use money.setup({ chain: "${chain}" }) instead.`, {
        chain,
        note: `Built-in chains: ${supportedChains().join(', ')}. Use setup() for these.`,
      });
    }

    const network: NetworkType = networkOpt ?? 'testnet';

    // Persist custom chain definition
    const def: CustomChainDef = {
      type: 'evm',
      chainId,
      ...(explorer ? { explorer } : {}),
    };
    await setCustomChain(chain, def);

    // Build and persist the chain config so setup() can find it
    const key = configKey(chain, network);
    const chainConfig: ChainConfig = {
      rpc,
      keyfile: '~/.money/keys/evm.json',
      network: network === 'mainnet' ? 'mainnet' : 'testnet',
      defaultToken: defaultToken ?? 'ETH',
    };
    await setChainConfig(key, chainConfig);
  },

  async readContract(params: ReadContractParams): Promise<ReadContractResult> {
    const { chain, network, address, abi, idl, accounts, functionName, args } = params;

    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.readContract({ chain: "base", address: "0x...", abi: [...], functionName: "totalSupply" })',
      });
    }
    if (!address) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: address', {
        note: 'Provide the contract address:\n  await money.readContract({ chain: "base", address: "0x...", abi: [...], functionName: "totalSupply" })',
      });
    }
    if (!functionName) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: functionName', {
        note: 'Provide the function to call:\n  await money.readContract({ chain: "base", address: "0x...", abi: [...], functionName: "totalSupply" })',
      });
    }
    // Must provide either abi (EVM) or idl (Solana)
    if (!abi && !idl) {
      throw new MoneyError('INVALID_PARAMS', 'Provide either "abi" (EVM) or "idl" (Solana) to describe the contract interface.', {
        note: 'EVM:\n  await money.readContract({ chain: "base", address: "0x...", abi: [...], functionName: "..." })\nSolana:\n  await money.readContract({ chain: "solana", address: "...", idl: {...}, functionName: "..." })',
      });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key } = resolved;
    const adapter = await getAdapter(key);

    if (!adapter.readContract) {
      throw new MoneyError('UNSUPPORTED_OPERATION', `readContract is not supported on chain "${chain}".`, {
        chain,
        note: `readContract is supported on EVM chains and Solana.`,
      });
    }

    const result = await adapter.readContract({ address, abi, idl, accounts, functionName, args });
    const { chain: resolvedChain, network: resolvedNetwork } = parseConfigKey(key);

    return {
      chain: resolvedChain,
      network: resolvedNetwork as NetworkType,
      result,
      note: '',
    };
  },

  async writeContract(params: WriteContractParams): Promise<WriteContractResult> {
    const { chain, network, address, abi, idl, accounts, functionName, args, value } = params;

    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.writeContract({ chain: "base", address: "0x...", abi: [...], functionName: "mint", args: [100] })',
      });
    }
    if (!address) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: address', {
        note: 'Provide the contract address:\n  await money.writeContract({ chain: "base", address: "0x...", abi: [...], functionName: "mint", args: [100] })',
      });
    }
    if (!functionName) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: functionName', {
        note: 'Provide the function to call:\n  await money.writeContract({ chain: "base", address: "0x...", abi: [...], functionName: "mint", args: [100] })',
      });
    }
    if (!abi && !idl) {
      throw new MoneyError('INVALID_PARAMS', 'Provide either "abi" (EVM) or "idl" (Solana) to describe the contract interface.', {
        note: 'EVM:\n  await money.writeContract({ chain: "base", address: "0x...", abi: [...], functionName: "..." })\nSolana:\n  await money.writeContract({ chain: "solana", address: "...", idl: {...}, functionName: "...", accounts: {...} })',
      });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key, chainConfig } = resolved;
    const adapter = await getAdapter(key);

    if (!adapter.writeContract) {
      throw new MoneyError('UNSUPPORTED_OPERATION', `writeContract is not supported on chain "${chain}".`, {
        chain,
        note: `writeContract is supported on EVM chains and Solana.`,
      });
    }

    const keyfilePath = expandHome(chainConfig.keyfile);

    // Convert value from human units to raw — EVM uses 18 decimals, Solana uses 9
    let valueBigInt: bigint | undefined;
    if (value) {
      const decimals = idl ? 9 : 18; // Solana (SOL=9) vs EVM (ETH=18)
      valueBigInt = parseUnits(value, decimals);
    }

    let result: { txHash: string; explorerUrl: string; fee: string };
    try {
      result = await adapter.writeContract({
        address,
        abi,
        idl,
        accounts,
        functionName,
        args,
        value: valueBigInt,
        keyfile: keyfilePath,
      });
    } catch (err: unknown) {
      if (err instanceof MoneyError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new MoneyError('TX_FAILED', msg, { chain, note: `Wait 5 seconds, then retry:\n  await money.writeContract({ chain: "${chain}", address: "${address}", ... })` });
    }

    // Record in history
    const { chain: sentChain, network: sentNetwork } = parseConfigKey(key);
    await appendHistory({
      ts: new Date().toISOString(),
      chain: sentChain,
      network: sentNetwork,
      to: address,
      amount: value ?? '0',
      token: `contract:${functionName}`,
      txHash: result.txHash,
    });

    return { ...result, chain: sentChain, network: sentNetwork as NetworkType, note: '' };
  },

  async fetchContractInterface(params: FetchContractInterfaceParams): Promise<FetchContractInterfaceResult> {
    const { chain, network, address } = params;

    if (!chain) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: chain', {
        note: 'Provide a chain name:\n  await money.fetchContractInterface({ chain: "base", address: "0x..." })',
      });
    }
    if (!address) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: address', {
        note: 'Provide the contract address:\n  await money.fetchContractInterface({ chain: "base", address: "0x..." })',
      });
    }

    const config = await loadConfig();
    const resolved = resolveChainKey(chain, config.chains, network);
    if (!resolved) {
      throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${chain}" is not configured.`, {
        chain,
        note: `Run setup first:\n  await money.setup({ chain: "${chain}" })`,
      });
    }
    const { key } = resolved;
    const adapter = await getAdapter(key);

    if (!adapter.fetchContractInterface) {
      throw new MoneyError('UNSUPPORTED_OPERATION', `fetchContractInterface is not supported on chain "${chain}".`, {
        chain,
        note: `fetchContractInterface is supported on EVM chains and Solana.`,
      });
    }

    const result = await adapter.fetchContractInterface(address);
    const { chain: resolvedChain, network: resolvedNetwork } = parseConfigKey(key);

    let note = '';
    if (!result.abi && !result.idl) {
      note = `No verified contract interface found for ${address} on ${chain}. For EVM: contract may not be verified on Sourcify. For Solana: program may not have published an Anchor IDL on-chain.`;
    }

    return {
      chain: resolvedChain,
      network: resolvedNetwork as NetworkType,
      address,
      name: result.name,
      abi: result.abi,
      idl: result.idl,
      note,
    };
  },

  async toRawUnits(params: ParseUnitsParams): Promise<bigint> {
    const { amount, chain, network, token, decimals: explicitDecimals } = params;

    if (amount === undefined || amount === null) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: amount', {
        note: 'Provide an amount:\n  await money.toRawUnits({ amount: 25, token: "USDC", chain: "base" })',
      });
    }

    const dec = await resolveDecimals({ chain, network, token, decimals: explicitDecimals });
    return parseUnits(String(amount), dec);
  },

  async toHumanUnits(params: FormatUnitsParams): Promise<string> {
    const { amount, chain, network, token, decimals: explicitDecimals } = params;

    if (amount === undefined || amount === null) {
      throw new MoneyError('INVALID_PARAMS', 'Missing required param: amount', {
        note: 'Provide an amount:\n  await money.toHumanUnits({ amount: 25000000n, token: "USDC", chain: "base" })',
      });
    }

    const dec = await resolveDecimals({ chain, network, token, decimals: explicitDecimals });
    return formatUnits(BigInt(amount), dec);
  },
};

// ─── Decimals resolution helper ───────────────────────────────────────────────

/** Known native token decimals */
const NATIVE_DECIMALS: Record<string, number> = {
  SET: 18,
  ETH: 18,
  SOL: 9,
};

/**
 * Resolve decimals from explicit value, token alias lookup, or native token defaults.
 */
async function resolveDecimals(opts: {
  chain?: string;
  network?: NetworkType;
  token?: string;
  decimals?: number;
}): Promise<number> {
  // Explicit decimals always wins
  if (opts.decimals !== undefined) return opts.decimals;

  // Need chain to look up token
  if (!opts.chain) {
    throw new MoneyError('INVALID_PARAMS', 'Provide either "decimals" or "chain" (to look up token decimals)', {
      note: 'Either pass decimals explicitly:\n  await money.toRawUnits({ amount: 25, decimals: 6 })\nOr pass chain + token:\n  await money.toRawUnits({ amount: 25, token: "USDC", chain: "base" })',
    });
  }

  const config = await loadConfig();
  const resolved = resolveChainKey(opts.chain, config.chains, opts.network);

  if (!resolved) {
    throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${opts.chain}" is not configured.`, {
      chain: opts.chain,
      note: `Run setup first:\n  await money.setup({ chain: "${opts.chain}" })`,
    });
  }

  const { key, chainConfig } = resolved;
  const tokenName = opts.token ?? chainConfig.defaultToken;

  // Check native token defaults first
  const nativeDec = NATIVE_DECIMALS[tokenName];
  if (tokenName === chainConfig.defaultToken && nativeDec !== undefined) {
    return nativeDec;
  }

  // Look up from aliases
  const alias = await getAlias(key, tokenName);
  if (alias) return alias.decimals;

  // If it's the native token but not in our known list, default to 18
  if (tokenName === chainConfig.defaultToken) return 18;

  throw new MoneyError('TOKEN_NOT_FOUND', `Cannot resolve decimals for token "${tokenName}" on chain "${opts.chain}".`, {
    chain: opts.chain,
    note: `Register the token first:\n  await money.registerToken({ chain: "${opts.chain}", name: "${tokenName}", address: "0x...", decimals: 6 })`,
  });
}

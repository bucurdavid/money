/**
 * fiat.ts — Fiat on/off-ramp client for the money SDK
 *
 * Communicates with a middleware API (fiatHost) that handles KYC, bank transfers,
 * and crypto on/off-ramp operations. Auth is done via EIP-191 message signing
 * with the configured EVM wallet.
 */

import { loadConfig, saveConfig } from './config.js';
import { loadKeyfile } from './keys.js';
import { MoneyError } from './errors.js';
import { expandHome } from './utils.js';
import { configKey } from './defaults.js';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  FiatCreateAccountParams,
  FiatCreateAccountResult,
  FiatGetKycLinkParams,
  FiatGetKycLinkResult,
  FiatLinkWalletParams,
  FiatLinkWalletResult,
  FiatCreateRecipientParams,
  FiatCreateRecipientResult,
  FiatQuoteParams,
  FiatQuoteResult,
  FiatOnRampParams,
  FiatOnRampResult,
  FiatOffRampParams,
  FiatOffRampResult,
  FiatGetFundingAddressParams,
  FiatGetFundingAddressResult,
  FiatStatusParams,
  FiatStatusResult,
} from './types.js';

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Build auth headers by signing a timestamp message with the EVM wallet key.
 * EVM chains share the same keyfile, so any configured EVM chain works.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const config = await loadConfig();

  let evmKeyfile: string | null = null;
  for (const [, cc] of Object.entries(config.chains)) {
    if (cc.keyfile && cc.keyfile.includes('evm')) {
      evmKeyfile = cc.keyfile;
      break;
    }
  }

  if (!evmKeyfile) {
    throw new MoneyError('CHAIN_NOT_CONFIGURED', 'No EVM chain configured. Set up an EVM chain first for fiat auth.', {
      note: 'Set up any EVM chain first:\n  await money.setup({ chain: "base" })',
    });
  }

  const kp = await loadKeyfile(expandHome(evmKeyfile));
  const account = privateKeyToAccount(`0x${kp.privateKey}` as `0x${string}`);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `money-fiat:${timestamp}`;
  const signature = await account.signMessage({ message });

  return {
    'X-Wallet-Address': account.address,
    'X-Wallet-Signature': signature,
    'X-Wallet-Timestamp': timestamp,
  };
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the fiat middleware API.
 */
async function fiatFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const config = await loadConfig();
  const host = config.fiatHost;

  if (!host) {
    throw new MoneyError('INVALID_PARAMS', 'Fiat host not configured.', {
      note: 'Configure the fiat middleware host first:\n  await money.configureFiat({ host: "https://your-app.vercel.app" })',
    });
  }

  const auth = await getAuthHeaders();
  const res = await fetch(`${host}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...auth,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as Record<string, unknown>;
    throw new MoneyError('TX_FAILED', (err.message as string) ?? `Fiat API error: ${res.status}`, {
      details: err,
    });
  }

  return res.json() as Promise<T>;
}

// ─── Account ID helper ────────────────────────────────────────────────────────

/**
 * Resolve the Due account ID from params or persisted config.
 */
async function getAccountId(params: { accountId?: string }): Promise<string> {
  if (params.accountId) return params.accountId;
  const config = await loadConfig();
  if (!config.fiatAccountId) {
    throw new MoneyError('INVALID_PARAMS', 'No Due account ID found. Create an account first.', {
      note: 'Create a Due account first:\n  await money.fiat.createAccount({ email: "user@example.com", firstName: "John", lastName: "Doe" })',
    });
  }
  return config.fiatAccountId;
}

// ─── Fiat client factory ──────────────────────────────────────────────────────

/**
 * Create a fiat client with all on/off-ramp methods.
 * The money object calls this once and exposes it as money.fiat.
 */
export function createFiatClient(): {
  createAccount(params: FiatCreateAccountParams): Promise<FiatCreateAccountResult>;
  getKycLink(params?: FiatGetKycLinkParams): Promise<FiatGetKycLinkResult>;
  linkWallet(params: FiatLinkWalletParams): Promise<FiatLinkWalletResult>;
  createRecipient(params: FiatCreateRecipientParams): Promise<FiatCreateRecipientResult>;
  quote(params: FiatQuoteParams): Promise<FiatQuoteResult>;
  onRamp(params: FiatOnRampParams): Promise<FiatOnRampResult>;
  offRamp(params: FiatOffRampParams): Promise<FiatOffRampResult>;
  getFundingAddress(params: FiatGetFundingAddressParams): Promise<FiatGetFundingAddressResult>;
  status(params: FiatStatusParams): Promise<FiatStatusResult>;
} {
  return {
    async createAccount(params: FiatCreateAccountParams): Promise<FiatCreateAccountResult> {
      if (!params.email || !params.firstName || !params.lastName) {
        throw new MoneyError('INVALID_PARAMS', 'Missing required params: email, firstName, lastName', {
          note: 'await money.fiat.createAccount({ email: "user@example.com", firstName: "John", lastName: "Doe" })',
        });
      }

      const data = await fiatFetch<{ id: string; kycUrl?: string }>('/api/fiat/accounts', {
        method: 'POST',
        body: {
          type: 'individual',
          email: params.email,
          details: { firstName: params.firstName, lastName: params.lastName },
        },
      });

      // Auto-persist accountId
      const config = await loadConfig();
      config.fiatAccountId = data.id;
      await saveConfig(config);

      return {
        accountId: data.id,
        kycUrl: data.kycUrl ?? '',
        note: data.kycUrl ? 'User must complete KYC at the URL before transfers are enabled.' : '',
      };
    },

    async getKycLink(params: FiatGetKycLinkParams = {}): Promise<FiatGetKycLinkResult> {
      const accountId = await getAccountId(params);
      const data = await fiatFetch<{ url: string }>(`/api/fiat/accounts/${accountId}/kyc`);
      return {
        url: data.url,
        note: 'Share this URL with the user to complete identity verification.',
      };
    },

    async linkWallet(params: FiatLinkWalletParams): Promise<FiatLinkWalletResult> {
      const accountId = await getAccountId(params);
      const config = await loadConfig();
      const ck = params.network ? configKey(params.chain, params.network) : params.chain;
      const chainConfig = config.chains[ck];

      if (!chainConfig) {
        throw new MoneyError('CHAIN_NOT_CONFIGURED', `Chain "${params.chain}" is not configured.`, {
          chain: params.chain,
          note: `Set up the chain first:\n  await money.setup({ chain: "${params.chain}" })`,
        });
      }

      const keyfilePath = expandHome(chainConfig.keyfile);
      const kp = await loadKeyfile(keyfilePath);
      let address: string;

      if (chainConfig.keyfile.includes('evm')) {
        const account = privateKeyToAccount(`0x${kp.privateKey}` as `0x${string}`);
        address = account.address;
      } else if (chainConfig.keyfile.includes('solana')) {
        const { PublicKey } = await import('@solana/web3.js');
        const pubKeyBytes = Buffer.from(kp.publicKey, 'hex');
        address = new PublicKey(pubKeyBytes).toBase58();
      } else {
        const { bech32m } = await import('bech32');
        const pubKeyBytes = Buffer.from(kp.publicKey, 'hex');
        const words = bech32m.toWords(pubKeyBytes);
        address = bech32m.encode('set', words);
      }

      const data = await fiatFetch<{ id: string; address?: string }>('/api/fiat/wallets', {
        method: 'POST',
        body: { address, accountId },
      });

      // Auto-persist walletId
      config.fiatWalletId = data.id;
      await saveConfig(config);

      return {
        walletId: data.id,
        address: data.address ?? address,
        note: '',
      };
    },

    async createRecipient(params: FiatCreateRecipientParams): Promise<FiatCreateRecipientResult> {
      const accountId = await getAccountId(params);

      if (!params.name || !params.details) {
        throw new MoneyError('INVALID_PARAMS', 'Missing required params: name, details', {
          note: 'await money.fiat.createRecipient({ name: "Alice", details: { accountNumber: "...", routingNumber: "..." } })',
        });
      }

      const data = await fiatFetch<{ id: string }>('/api/fiat/recipients', {
        method: 'POST',
        body: { name: params.name, details: params.details, accountId },
      });

      return { recipientId: data.id, note: '' };
    },

    async quote(params: FiatQuoteParams): Promise<FiatQuoteResult> {
      const accountId = await getAccountId(params);

      const data = await fiatFetch<Record<string, unknown>>('/api/fiat/quotes', {
        method: 'POST',
        body: { source: params.source, destination: params.destination, accountId },
      });

      return {
        quoteToken: data.token as string,
        source: data.source as FiatQuoteResult['source'],
        destination: data.destination as FiatQuoteResult['destination'],
        fxRate: data.fxRate as number,
        expiresAt: data.expiresAt as string,
        note: 'Quote expires in 2 minutes. Use quoteToken to create a transfer.',
      };
    },

    async onRamp(params: FiatOnRampParams): Promise<FiatOnRampResult> {
      const accountId = await getAccountId(params);
      const config = await loadConfig();
      const walletId = params.walletId ?? config.fiatWalletId;

      if (!walletId) {
        throw new MoneyError('INVALID_PARAMS', 'No wallet linked. Link a wallet first.', {
          note: 'Link your wallet first:\n  await money.fiat.linkWallet({ chain: "base" })',
        });
      }

      const data = await fiatFetch<Record<string, unknown>>('/api/fiat/transfers', {
        method: 'POST',
        body: { quote: params.quoteToken, recipient: walletId, accountId },
      });

      return {
        transferId: data.id as string,
        bankingDetails: (data.bankingDetails as Record<string, unknown>) ?? {},
        note: 'Give the banking details to the user so they can send fiat from their bank.',
      };
    },

    async offRamp(params: FiatOffRampParams): Promise<FiatOffRampResult> {
      const accountId = await getAccountId(params);

      const data = await fiatFetch<Record<string, unknown>>('/api/fiat/transfers', {
        method: 'POST',
        body: { quote: params.quoteToken, recipient: params.recipientId, accountId },
      });

      return {
        transferId: data.id as string,
        note: 'Transfer created. Get a funding address next:\n  await money.fiat.getFundingAddress({ transferId: "..." })',
      };
    },

    async getFundingAddress(params: FiatGetFundingAddressParams): Promise<FiatGetFundingAddressResult> {
      const accountId = await getAccountId(params);

      const data = await fiatFetch<Record<string, unknown>>(`/api/fiat/transfers/${params.transferId}/funding`, {
        method: 'POST',
        body: { accountId },
      });

      return {
        address: data.address as string,
        chain: (data.chain as string) ?? '',
        amount: (data.amount as string) ?? '',
        note: 'Send the exact amount to this address using money.send():\n  await money.send({ to: "...", amount: "...", chain: "...", token: "USDC", network: "mainnet" })',
      };
    },

    async status(params: FiatStatusParams): Promise<FiatStatusResult> {
      const accountId = await getAccountId(params);

      const data = await fiatFetch<Record<string, unknown>>(
        `/api/fiat/transfers/${params.transferId}?accountId=${accountId}`,
      );

      return {
        status: data.status as string,
        source: data.source as FiatStatusResult['source'],
        destination: data.destination as FiatStatusResult['destination'],
        note: '',
      };
    },
  };
}

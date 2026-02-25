/**
 * providers/fasttoken.ts — Fast chain token info provider
 *
 * Uses the FastSet proxy_getTokenInfo RPC to query on-chain token metadata.
 * Registered as a PriceProvider scoped to chain: "fast".
 */

import type { PriceProvider } from './types.js';
import { loadConfig } from '../config.js';
import { DEFAULT_CHAIN_CONFIGS } from '../defaults.js';

/** Native SET token ID: 0xfa575e70 padded to 32 bytes */
const SET_TOKEN_HEX = 'fa575e700000000000000000000000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// JSON helper for Uint8Array serialization
// ---------------------------------------------------------------------------

function toJSON(data: unknown): string {
  return JSON.stringify(data, (_k, v) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return v.toString();
    return v;
  });
}

// ---------------------------------------------------------------------------
// RPC helper
// ---------------------------------------------------------------------------

async function rpcCall(
  url: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: toJSON({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const json = (await res.json()) as {
      result?: unknown;
      error?: { message: string; code?: number };
    };
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const padded = clean.padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: number[] | Uint8Array): string {
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

function isNativeSetToken(hex: string): boolean {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  return clean.toLowerCase().padEnd(64, '0') === SET_TOKEN_HEX;
}

/** Get the Fast RPC URL from config, falling back to the default */
async function getFastRpcUrl(): Promise<string> {
  try {
    const config = await loadConfig();
    // Check both testnet and mainnet keys
    const fastTestnet = config.chains['fast:testnet'] ?? config.chains['fast'];
    const fastMainnet = config.chains['fast:mainnet'];
    const chainConfig = fastMainnet ?? fastTestnet;
    if (chainConfig?.rpc) return chainConfig.rpc;
  } catch {
    // Config not available — use default
  }
  return DEFAULT_CHAIN_CONFIGS.fast.testnet.rpc;
}

// ---------------------------------------------------------------------------
// Token metadata response types
// ---------------------------------------------------------------------------

interface TokenMetadata {
  update_id: number;
  admin: number[];
  token_name: string;
  decimals: number;
  total_supply: string;
  mints: number[][];
}

interface TokenInfoRpcResult {
  requested_token_metadata: Array<[number[], TokenMetadata | null]>;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const fastTokenProvider: PriceProvider = {
  name: 'fast',
  chains: ['fast'],

  async getPrice({ token }) {
    // Fast tokens don't have DEX price data
    if (isNativeSetToken(token) || token.toUpperCase() === 'SET') {
      return { price: '0', symbol: 'SET', name: 'SET' };
    }

    const rpcUrl = await getFastRpcUrl();
    const tokenIdBytes = hexToBytes(token);
    const result = (await rpcCall(rpcUrl, 'proxy_getTokenInfo', {
      token_ids: [tokenIdBytes],
    })) as TokenInfoRpcResult | null;

    const meta = result?.requested_token_metadata?.[0]?.[1];
    if (!meta) {
      throw new Error(`Token not found on Fast chain: "${token}"`);
    }

    return {
      price: '0',
      symbol: meta.token_name,
      name: meta.token_name,
    };
  },

  async getTokenInfo({ token }) {
    // Handle native SET token (RPC returns null for it)
    if (isNativeSetToken(token) || token.toUpperCase() === 'SET') {
      return {
        name: 'SET',
        symbol: 'SET',
        address: `0x${SET_TOKEN_HEX}`,
        decimals: 18,
        price: '0',
        pairs: [],
        totalSupply: undefined,
        admin: undefined,
        minters: undefined,
      };
    }

    const rpcUrl = await getFastRpcUrl();
    const tokenIdBytes = hexToBytes(token);
    const result = (await rpcCall(rpcUrl, 'proxy_getTokenInfo', {
      token_ids: [tokenIdBytes],
    })) as TokenInfoRpcResult | null;

    const entry = result?.requested_token_metadata?.[0];
    if (!entry) {
      throw new Error(`Token not found on Fast chain: "${token}"`);
    }

    const [tokenIdRaw, meta] = entry;
    if (!meta) {
      throw new Error(`Token not found on Fast chain: "${token}"`);
    }

    return {
      name: meta.token_name,
      symbol: meta.token_name,
      address: bytesToHex(tokenIdRaw),
      decimals: meta.decimals,
      price: '0',
      pairs: [],
      admin: bytesToHex(meta.admin),
      minters: meta.mints.map((m) => bytesToHex(m)),
      totalSupply: meta.total_supply,
    };
  },
};

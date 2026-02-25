/**
 * providers/registry.ts — Provider registration and selection
 */

import type { SwapProvider, BridgeProvider, PriceProvider } from './types.js';

// ─── Storage ──────────────────────────────────────────────────────────────────

const swapProviders: SwapProvider[] = [];
const bridgeProviders: BridgeProvider[] = [];
const priceProviders: PriceProvider[] = [];

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerSwapProvider(provider: SwapProvider): void {
  // Remove existing provider with same name if re-registering
  const idx = swapProviders.findIndex((p) => p.name === provider.name);
  if (idx >= 0) swapProviders.splice(idx, 1);
  swapProviders.push(provider);
}

export function registerBridgeProvider(provider: BridgeProvider): void {
  const idx = bridgeProviders.findIndex((p) => p.name === provider.name);
  if (idx >= 0) bridgeProviders.splice(idx, 1);
  bridgeProviders.push(provider);
}

export function registerPriceProvider(provider: PriceProvider): void {
  const idx = priceProviders.findIndex((p) => p.name === provider.name);
  if (idx >= 0) priceProviders.splice(idx, 1);
  priceProviders.push(provider);
}

// ─── Selection ────────────────────────────────────────────────────────────────

/**
 * Get swap provider by name, or the first one that supports the given chain.
 * Returns null if no provider found.
 */
export function getSwapProvider(chain: string, providerName?: string): SwapProvider | null {
  if (providerName) {
    return swapProviders.find((p) => p.name === providerName) ?? null;
  }
  return swapProviders.find((p) => p.chains.includes(chain)) ?? null;
}

export function getBridgeProvider(providerName?: string): BridgeProvider | null {
  if (providerName) {
    return bridgeProviders.find((p) => p.name === providerName) ?? null;
  }
  return bridgeProviders[0] ?? null;
}

export function getPriceProvider(providerName?: string): PriceProvider | null {
  if (providerName) {
    return priceProviders.find((p) => p.name === providerName) ?? null;
  }
  return priceProviders[0] ?? null;
}

// ─── Listing ──────────────────────────────────────────────────────────────────

export function listSwapProviders(): Array<{ name: string; chains: string[] }> {
  return swapProviders.map((p) => ({ name: p.name, chains: [...p.chains] }));
}

export function listBridgeProviders(): Array<{ name: string; chains: string[] }> {
  return bridgeProviders.map((p) => ({ name: p.name, chains: [...p.chains] }));
}

export function listPriceProviders(): Array<{ name: string }> {
  return priceProviders.map((p) => ({ name: p.name }));
}

// ─── Reset (for testing) ─────────────────────────────────────────────────────

export function _resetProviders(): void {
  swapProviders.length = 0;
  bridgeProviders.length = 0;
  priceProviders.length = 0;
}

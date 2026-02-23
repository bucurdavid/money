import type { HistoryEntry } from '../types.js';

export interface ChainAdapter {
  chain: string;
  addressPattern: RegExp;

  getBalance(address: string, token?: string): Promise<{ amount: string; token: string }>;

  send(params: {
    from: string;
    to: string;
    amount: string;   // Human-readable
    token?: string;
    memo?: string;
    keyfile: string;  // Path to keyfile — adapter loads, signs, scrubs
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }>;

  faucet(address: string): Promise<{ amount: string; token: string; txHash: string }>;

  setupWallet(keyfilePath: string): Promise<{ address: string }>;

  getHistory?(address: string, limit?: number): Promise<HistoryEntry[]>;
}

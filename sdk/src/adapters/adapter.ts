export interface ChainAdapter {
  chain: string;
  addressPattern: RegExp;

  getBalance(address: string, token?: string): Promise<{ amount: string; token: string }>;

  send(params: {
    from: string;
    to: string;
    amount: string;
    token?: string;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }>;

  faucet(address: string): Promise<{ amount: string; token: string; txHash: string }>;

  setupWallet(keyfilePath: string): Promise<{ address: string }>;

  readContract?(params: {
    address: string;
    abi?: unknown[];
    idl?: unknown;
    accounts?: Record<string, string>;
    functionName: string;
    args?: unknown[];
  }): Promise<unknown>;

  writeContract?(params: {
    address: string;
    abi?: unknown[];
    idl?: unknown;
    accounts?: Record<string, string>;
    functionName: string;
    args?: unknown[];
    value?: bigint;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }>;

  fetchContractInterface?(address: string): Promise<{
    name: string | null;
    abi: unknown[] | null;
    idl: unknown | null;
  }>;
}

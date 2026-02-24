export interface ChainAdapter {
  chain: string;
  addressPattern: RegExp;

  getBalance(address: string, token?: string): Promise<{ amount: string; token: string }>;

  send(params: {
    from: string;
    to: string;
    amount: string;
    token?: string;
    memo?: string;
    keyfile: string;
  }): Promise<{ txHash: string; explorerUrl: string; fee: string }>;

  faucet(address: string): Promise<{ amount: string; token: string; txHash: string }>;

  setupWallet(keyfilePath: string): Promise<{ address: string }>;
}

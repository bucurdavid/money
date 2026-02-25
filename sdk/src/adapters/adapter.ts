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

  sign(params: {
    message: string | Uint8Array;
    keyfile: string;
  }): Promise<{ signature: string; address: string }>;

  /** Discover all tokens owned by an address (optional — not all chains support this) */
  ownedTokens?(address: string): Promise<Array<{
    symbol: string;
    address: string;
    balance: string;
    rawBalance: string;
    decimals: number;
  }>>;
}

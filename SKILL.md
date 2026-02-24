# I-WANT-TO-USE-MONEY

Send tokens across chains. Fast (SET), Base/Ethereum/Arbitrum (USDC), Solana (SOL/USDC).

## Setup

```js
import { money } from '@fast/money';
await money.setup("fast");  // creates wallet at ~/.money/keys/fast.json
```

## Network Selection

By default, all chains use **testnet**. To use mainnet:

```js
await money.setup("fast", { network: "mainnet" });
```

⚠️ **Mainnet uses real money.** Faucets are disabled on mainnet. Both testnet and mainnet wallets can coexist — each uses a separate keyfile.

| Network | Faucet | Keyfile suffix |
|---------|--------|----------------|
| testnet (default) | ✅ Fast, Solana | `keys/<chain>.json` |
| mainnet | ❌ disabled | `keys/<chain>-mainnet.json` |

## Custom RPC

```js
await money.setup("base", { network: "mainnet", rpc: "https://your-alchemy-url.com" });
```

The RPC is stored in config and persists — no need to pass it on every call.

## Tokens

USDC is automatically seeded as an alias on `setup()` for Base, Ethereum, Arbitrum, and Solana.

```js
// USDC works immediately after setup — no registration
await money.send("0x1234...abcd", 25, { token: "USDC" });

// Pass any raw ERC-20/SPL address directly — decimals fetched on-chain automatically
await money.send("0x1234...abcd", 0.5, { token: "0x4200000000000000000000000000000000000006" });

// Or register a named alias (stored in ~/.money/aliases.json)
await money.alias("base", "WETH", { address: "0x4200000000000000000000000000000000000006", decimals: 18 });
await money.alias("solana", "USDT", { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 });

// GET an alias
const info = await money.alias("base", "WETH");
// → { chain: "base", name: "WETH", address: "0x42...", decimals: 18 }

// List all aliases for a chain
const aliases = await money.aliases("base");
```

## Send Tokens

1. Check balance
2. If low and testnet, get free tokens
3. Send

```js
const bal = await money.balance("fast");
console.log(bal.amount, bal.token);

await money.faucet("fast");  // free testnet tokens (Fast + Solana only)

await money.send("set1qxy2kfcg...", 10);  // chain auto-detected from address
```

## Check All Balances

```js
const wallets = await money.wallets();
for (const w of wallets) console.log(w.chain, w.balances);
```

## Transaction History

Sends are recorded locally in `~/.money/history.csv`.

```js
const all = await money.history();
const fast = await money.history("fast");        // filter by chain
const recent = await money.history(undefined, 10); // last 10 across all chains
// → [{ ts, chain, to, amount, token, txHash }, ...]
```

## Which Chain?

Address format determines the chain automatically:
- `set1...` → Fast (token: SET)
- `0x` + 40 hex chars → first configured EVM chain (Base, Ethereum, or Arbitrum), defaulting to Base. Override with `{ chain: "ethereum" }` or `{ chain: "arbitrum" }`
- Base58, 32-44 chars → Solana (token: SOL)

To send USDC on Ethereum instead of Base:
```js
await money.send("0x1234...abcd", 25, { chain: "ethereum", token: "USDC" });
```

## Handle Errors

Every error has `.code`:

```js
try {
  await money.send(to, amount);
} catch (e) {
  if (e.code === "INSUFFICIENT_BALANCE") await money.faucet("fast");
  if (e.code === "CHAIN_NOT_CONFIGURED") await money.setup("fast");
  if (e.code === "TX_FAILED") console.error(e.message);
  if (e.code === "INVALID_ADDRESS") console.error("bad address");
}
```

## All Methods

| Method | Returns |
|--------|---------|
| `money.setup(chain, opts?)` | `{ chain, address, network }` |
| `money.balance(chain?)` | `{ amount, token, chain, address }` or array |
| `money.send(to, amount, opts?)` | `{ txHash, explorerUrl, fee, chain }` |
| `money.faucet(chain)` | `{ amount, token, txHash, chain }` |
| `money.wallets()` | `[{ chain, address, balances }]` |
| `money.chains()` | `[{ chain, address, network, status }]` |
| `money.detect(address)` | `string` or `null` |
| `money.history(chain?, limit?)` | `[{ ts, chain, to, amount, token, txHash }]` |
| `money.alias(chain, name)` | `TokenInfo \| null` |
| `money.alias(chain, name, config)` | `null` |
| `money.aliases(chain)` | `TokenInfo[]` |

`opts` for setup: `{ network?: "testnet" \| "mainnet", rpc?: string }`  
`opts` for send: `{ chain?, token?, memo? }`  
`config` for alias: `{ address?, mint?, decimals? }`

### TokenInfo

```ts
{
  chain: string;     // config key, e.g. "base", "base:mainnet"
  name: string;      // token symbol, e.g. "USDC"
  address?: string;  // EVM contract address
  mint?: string;     // Solana SPL mint address
  decimals: number;
}
```

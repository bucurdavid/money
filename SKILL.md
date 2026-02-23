# I-WANT-TO-USE-MONEY

Send and receive tokens across chains. Fast (SET), Base/Ethereum/Arbitrum (USDC), Solana (SOL/USDC).

## Setup

```js
import { money } from '@fast/money';
await money.setup("fast");  // creates wallet at ~/.money/keys/fast.json
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

## Which Chain?

Address format determines the chain automatically:
- `set1...` → Fast (token: SET)
- `0x` + 40 hex chars → Base (token: USDC). Override with `{ chain: "ethereum" }` or `{ chain: "arbitrum" }`
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
| `money.setup(chain)` | `{ chain, address, network }` |
| `money.balance(chain?)` | `{ amount, token, chain }` |
| `money.send(to, amount, opts?)` | `{ txHash, explorerUrl, chain }` |
| `money.faucet(chain)` | `{ amount, token, txHash }` |
| `money.wallets()` | `[{ chain, address, balances }]` |
| `money.chains()` | `[{ chain, address, status }]` |
| `money.detect(address)` | `string` or `null` |
| `money.history(chain?, limit?)` | `[{ txHash, direction, amount }]` |

`opts`: `{ chain?, token?, memo? }`

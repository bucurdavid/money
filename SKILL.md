---
name: money-skill
description: >
  Send tokens on Fast, Base, Ethereum, Arbitrum, or Solana using @fast/money.
  Use when asked to pay, transfer tokens, fund a wallet, or check a balance.
  Do NOT use for trading, DeFi, yield farming, price advice, or detecting incoming payments.
---

# MONEY SKILL

Everything works out of the box. RPCs, token addresses, explorer URLs — all built in for 5 chains, testnet and mainnet. You do not need API keys, ABIs, or config files.

The entire SDK is 3 steps:

```js
import { money } from '@fast/money';
await money.setup("fast");                          // 1. create wallet (once)
const bal = await money.balance("fast");            // 2. check balance
const tx = await money.send("set1qxy...", 10);      // 3. send tokens
```

That pattern is identical on every chain. Only the chain name and address format change.

Supported chains: `"fast"` `"base"` `"ethereum"` `"arbitrum"` `"solana"`

## What do you want to do?

| Goal | Go to |
|------|-------|
| Set up a wallet | Setup |
| Send tokens | Send Tokens |
| Check balance | Check Balance |
| Get free testnet tokens | Faucet |
| Handle an error | Error Recovery |
| Avoid sending twice | Idempotency |
| Check if you received tokens | Receiving |
| Use USDC or a custom token | Tokens |
| View past sends | History |
| See all methods | Reference |

## NOT for this skill

Stop. Tell the user this skill cannot help with: trading, swapping, DeFi, yield, lending, staking, price advice, or detecting incoming payments from external senders.

## Rules

1. **Default is testnet.** Testnet is safe. Mainnet uses real money — opt in explicitly with `{ network: "mainnet" }`.
2. **Sends are irreversible.** Verify the address before calling `send()`.
3. **Amounts are in human units.** `10` means 10 tokens, not 10 wei or 10 lamports.

---

## Setup

Call once per chain. Creates a wallet, stores RPC config. All defaults are built in — you only pass options to override.

```js
import { money } from '@fast/money';

// testnet (default) — safe, faucet available, RPC built in
const w = await money.setup("fast");
// w = { chain: "fast", address: "set1...", network: "testnet" }

// mainnet — real money, faucet disabled, optional custom RPC
const w = await money.setup("base", { network: "mainnet", rpc: "https://your-rpc-url" });
// w = { chain: "base", address: "0x...", network: "mainnet" }
```

Same call for every chain. Only the first argument changes. RPC is stored permanently — no need to pass it again.

---

## Send Tokens

The SDK detects the chain from the address format:

| Address looks like | Chain | Default token |
|---|---|---|
| `set1...` | Fast | SET |
| `0x` + 40 hex chars | Base (or override: Ethereum, Arbitrum) | ETH |
| Base58, 32-44 chars | Solana | SOL |

```js
// Fast — chain and token auto-detected
const tx = await money.send("set1qxy2kfcg...", 10);

// EVM — specify chain and token when address is 0x
const tx = await money.send("0x1234...abcd", 25, { chain: "ethereum", token: "USDC" });

// tx = { txHash, explorerUrl, fee, chain, network }
```

Solana works like Fast — chain auto-detected, pass `{ token: "USDC" }` for SPL tokens.

---

## Check Balance

```js
const bal = await money.balance("fast");
// bal = { amount: "42.5", token: "SET", chain: "fast", network: "testnet", address: "set1..." }

const all = await money.balance();  // all configured chains at once
```

---

## Faucet

Testnet only. Not available on mainnet.

```js
const r = await money.faucet("fast");
// r = { amount, token, txHash, chain, network }
```

If it throws `TX_FAILED`, the manual faucet URL is in `e.details.faucetUrl`.

---

## Error Recovery

| `e.code` | Meaning | Action |
|---|---|---|
| `INSUFFICIENT_BALANCE` | Not enough tokens | Testnet: `money.faucet(chain)`, retry. Mainnet: fund wallet. |
| `CHAIN_NOT_CONFIGURED` | No wallet for chain | `money.setup(chain)`, retry. |
| `TX_FAILED` | RPC/network error | Wait 5s, retry once. If still fails, stop. |
| `INVALID_ADDRESS` | Bad address | Do not retry. Confirm address with user. |
| `TOKEN_NOT_FOUND` | Token not registered | `money.alias(chain, name, { address, decimals })`, retry. |

```js
try {
  await money.send("set1qxy2kfcg...", 10);
} catch (e) {
  if (e.code === "INSUFFICIENT_BALANCE") {
    await money.faucet("fast");
    await money.send("set1qxy2kfcg...", 10);
  } else if (e.code === "CHAIN_NOT_CONFIGURED") {
    await money.setup("fast");
    await money.send("set1qxy2kfcg...", 10);
  } else if (e.code === "TX_FAILED") {
    await new Promise(r => setTimeout(r, 5000));
    await money.send("set1qxy2kfcg...", 10);
  } else {
    throw e;
  }
}
```

---

## Idempotency

Check history before sending to avoid double sends:

```js
const history = await money.history("fast");
const already = history.find(e => e.to === to && e.amount === String(amount));
if (already) {
  console.log("Already sent:", already.txHash);
} else {
  await money.send(to, amount);
}
```

---

## Receiving

This SDK does not detect incoming payments. Use balance delta as a proxy:

```js
const before = await money.balance("fast");
// ... wait ...
const after = await money.balance("fast");
const delta = parseFloat(after.amount) - parseFloat(before.amount);
if (delta > 0) console.log("Received:", delta, after.token);
```

For confirmed incoming verification, use a block explorer — outside this SDK.

---

## Tokens

USDC is pre-registered on Base, Ethereum, Arbitrum, and Solana after `setup()`. No extra steps.

```js
// Use a named alias
await money.send("0x1234...abcd", 25, { token: "USDC" });

// Use a raw contract/mint address — decimals fetched automatically
await money.send("0x1234...abcd", 0.5, { token: "0x4200000000000000000000000000000000000006" });

// Register a custom alias
await money.alias("base", "WETH", { address: "0x4200...0006", decimals: 18 });
await money.alias("solana", "USDT", { mint: "Es9vMF...NYB", decimals: 6 });

// Look up or list
const info = await money.alias("base", "WETH");
const all = await money.aliases("base");
```

---

## History

```js
const all = await money.history();           // all chains
const fast = await money.history("fast");    // one chain
const last5 = await money.history(5);        // last N across all chains

// Each entry: { ts, chain, network, to, amount, token, txHash }
```

---

## Reference

| Method | Returns |
|--------|---------|
| `money.setup(chain, opts?)` | `{ chain, address, network }` |
| `money.balance(chain?, opts?)` | `{ amount, token, chain, network, address }` or array |
| `money.send(to, amount, opts?)` | `{ txHash, explorerUrl, fee, chain, network }` |
| `money.faucet(chain)` | `{ amount, token, txHash, chain, network }` |
| `money.wallets()` | `[{ chain, network, address, balances }]` |
| `money.chains()` | `[{ chain, address, network, status }]` |
| `money.detect(address)` | `string` (chain name) or `null` |
| `money.history(chainOrLimit?, limit?)` | `[{ ts, chain, network, to, amount, token, txHash }]` |
| `money.alias(chain, name)` | `TokenInfo` or `null` |
| `money.alias(chain, name, config)` | `null` |
| `money.aliases(chain)` | `TokenInfo[]` |

`opts` for `setup`: `{ network?: "testnet" | "mainnet", rpc?: string }`
`opts` for `send`: `{ chain?: string, token?: string, memo?: string }`
`config` for `alias`: `{ address?: string, mint?: string, decimals?: number }`

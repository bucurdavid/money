---
name: money-skill
description: >
  Send tokens on Fast, Base, Ethereum, Arbitrum, or Solana using @fast/money.
  Use when asked to pay, transfer tokens, fund a wallet, or check a balance.
  Do NOT use for trading, DeFi, yield farming, price advice, or detecting incoming payments.
---

# MONEY SKILL

## What do you want to do?

| Goal | Go to |
|------|-------|
| Set up a wallet for the first time | §1 Setup |
| Send tokens to an address | §2 Send Tokens |
| Check balance | §3 Check Balance |
| Get free testnet tokens | §4 Faucet |
| Handle an error | §5 Error Recovery |
| Avoid sending twice | §6 Idempotency |
| Check if you received tokens | §7 Receiving |
| Use USDC or a custom token | §8 Tokens |
| View past sends | §9 History |
| See all methods | §10 Reference |

---

## NOT for this skill

Stop and tell the user this skill cannot help if they ask for:

- Token trading or swapping
- DeFi, yield, lending, staking
- Price advice or portfolio tracking
- Detecting incoming payments from external senders

---

## Before you send — 3 rules

1. **Testnet is safe. Mainnet uses real money.** Default is testnet. Opt in to mainnet explicitly.
2. **Crypto sends are irreversible.** Verify the address before calling `send()`.
3. **Amount is in human units.** `10` means 10 USDC, not 10 micro-USDC.

---

## §1 Setup

Call `setup()` once per chain. Creates a wallet keyfile at `~/.money/keys/<chain>.json`.

`chain` is one of: `"fast"` `"base"` `"ethereum"` `"arbitrum"` `"solana"`

```js
import { money } from '@fast/money';

// testnet (default) — safe, faucet available
const w = await money.setup("fast");
// w → { chain: "fast", address: "set1...", network: "testnet" }

// mainnet — real money, faucet disabled, separate keyfile
const w = await money.setup("base", { network: "mainnet", rpc: "https://your-rpc-url" });
// w → { chain: "base", address: "0x...", network: "mainnet" }
```

Same call for every chain — only the first argument changes.

---

## §2 Send Tokens

**Step 1 — which chain?** The address format decides:

| Address looks like | Chain |
|---|---|
| `set1...` | Fast (native token: SET) |
| `0x` + 40 hex chars | Base by default — override with `{ chain: "ethereum" }` or `{ chain: "arbitrum" }` |
| Base58, 32–44 chars | Solana (native token: SOL) |

**Step 2 — send:**

```js
// Fast — chain auto-detected, native token (SET), no opts needed
const r = await money.send("set1qxy2kfcg...", 10);

// EVM — same call for Base / Ethereum / Arbitrum, pick chain + token
const r = await money.send("0x1234...abcd", 25, { chain: "ethereum", token: "USDC" });

// r → { txHash, explorerUrl, fee, chain, network }
```

Solana works exactly like Fast — chain auto-detected from address, pass `{ token: "USDC" }` for SPL tokens.

---

## §3 Check Balance

```js
const bal = await money.balance("fast");
// bal → { amount: "42.5", token: "SET", chain: "fast", network: "testnet", address: "set1..." }

// All configured chains at once
const all = await money.balance();
for (const b of all) console.log(b.chain, b.amount, b.token);
```

---

## §4 Faucet (testnet only)

```js
const r = await money.faucet("fast");
// r → { amount, token, txHash, chain, network }
```

Not available on mainnet. If it throws `TX_FAILED`, the manual faucet URL is in `e.details.faucetUrl`.

---

## §5 Error Recovery

| `e.code` | What happened | What to do |
|---|---|---|
| `INSUFFICIENT_BALANCE` | Not enough tokens | Testnet: call `money.faucet(chain)`, then retry. Mainnet: fund the wallet. |
| `CHAIN_NOT_CONFIGURED` | No wallet for this chain | Call `money.setup(chain)`, then retry. |
| `TX_FAILED` | RPC or network error | Wait 5 s, retry once. If it fails again, log `e.message` and stop. |
| `INVALID_ADDRESS` | Bad address | Do not retry. Ask the user to confirm the address. |
| `TOKEN_NOT_FOUND` | Token not registered | Call `money.alias(chain, name, { address, decimals })`, then retry. |

```js
try {
  await money.send("set1qxy2kfcg...", 10);
} catch (e) {
  if (e.code === "INSUFFICIENT_BALANCE") {
    await money.faucet("fast");
    await money.send("set1qxy2kfcg...", 10);       // retry once
  } else if (e.code === "CHAIN_NOT_CONFIGURED") {
    await money.setup("fast");
    await money.send("set1qxy2kfcg...", 10);       // retry once
  } else if (e.code === "TX_FAILED") {
    await new Promise(r => setTimeout(r, 5000));
    await money.send("set1qxy2kfcg...", 10);       // retry once
  } else {
    throw e;                                       // do not retry
  }
}
```

---

## §6 Idempotency — avoid double sends

```js
const history = await money.history("fast");
const already = history.find(e => e.to === to && e.amount === String(amount));
if (already) {
  console.log("Already sent:", already.txHash);
} else {
  await money.send(to, amount);
}
```

Every send is recorded in `~/.money/history.csv`.

---

## §7 Receiving Payments

**This SDK does not detect incoming payments.** Use balance delta as a proxy:

```js
const before = await money.balance("fast");
// ... wait ...
const after  = await money.balance("fast");
const delta  = parseFloat(after.amount) - parseFloat(before.amount);
if (delta > 0) console.log("Received:", delta, after.token);
```

For confirmed incoming verification, use a block explorer — outside this SDK's scope.

---

## §8 Tokens and Aliases

USDC is pre-registered on Base, Ethereum, Arbitrum, and Solana after `setup()`.

```js
// Named alias (pre-registered or custom)
await money.send("0x1234...abcd", 25, { token: "USDC" });

// Raw contract / mint address — decimals fetched automatically
await money.send("0x1234...abcd", 0.5, { token: "0x4200000000000000000000000000000000000006" });

// Register a custom alias (stored in ~/.money/aliases.json)
await money.alias("base", "WETH", { address: "0x4200...0006", decimals: 18 });
await money.alias("solana", "USDT", { mint: "Es9vMF...NYB", decimals: 6 });

// Look up or list aliases
const info = await money.alias("base", "WETH");
const all  = await money.aliases("base");
```

---

## §9 History

```js
const all    = await money.history();               // all chains
const fast   = await money.history("fast");         // one chain
const recent = await money.history(undefined, 10);  // last N

// Each entry: { ts, chain, network, to, amount, token, txHash }
```

---

## §10 Reference — All Methods

| Method | Returns |
|--------|---------|
| `money.setup(chain, opts?)` | `{ chain, address, network }` |
| `money.balance(chain?, opts?)` | `{ amount, token, chain, network, address }` or array |
| `money.send(to, amount, opts?)` | `{ txHash, explorerUrl, fee, chain, network }` |
| `money.faucet(chain)` | `{ amount, token, txHash, chain, network }` |
| `money.wallets()` | `[{ chain, network, address, balances }]` |
| `money.chains()` | `[{ chain, address, network, status }]` |
| `money.detect(address)` | `string` (chain name) or `null` |
| `money.history(chain?, limit?)` | `[{ ts, chain, network, to, amount, token, txHash }]` |
| `money.alias(chain, name)` | `TokenInfo \| null` |
| `money.alias(chain, name, config)` | `null` |
| `money.aliases(chain)` | `TokenInfo[]` |

`opts` for `setup`: `{ network?: "testnet" | "mainnet", rpc?: string }`  
`opts` for `send`: `{ chain?: string, token?: string, memo?: string }`  
`config` for `alias`: `{ address?: string, mint?: string, decimals?: number }`

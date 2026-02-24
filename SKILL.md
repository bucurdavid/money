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

**Fast (testnet):**
```js
import { money } from '@fast/money';
const w = await money.setup("fast");
// w.address starts with "set1..."
```

**Base (testnet):**
```js
const w = await money.setup("base");
// w.address starts with "0x..."
```

**Ethereum / Arbitrum / Solana — same pattern:**
```js
await money.setup("ethereum");
await money.setup("arbitrum");
await money.setup("solana");
```

**Mainnet — add `{ network: "mainnet" }`:**
```js
await money.setup("base", { network: "mainnet" });
// Uses a separate keyfile: ~/.money/keys/base-mainnet.json
// Faucet is disabled on mainnet.
```

**Custom RPC (stored permanently, no need to pass again):**
```js
await money.setup("base", { network: "mainnet", rpc: "https://your-rpc-url" });
```

---

## §2 Send Tokens

**Step 1 — identify the chain from the address:**

| Address format | Chain |
|---|---|
| Starts with `set1` | Fast |
| Starts with `0x` + 40 hex chars | Base (default), Ethereum, or Arbitrum |
| Base58, 32–44 chars | Solana |

**Step 2 — send:**

Fast (chain auto-detected, native token is SET):
```js
const result = await money.send("set1qxy2kfcg...", 10);
console.log(result.txHash, result.explorerUrl);
```

Base USDC (chain auto-detected):
```js
const result = await money.send("0x1234...abcd", 25, { token: "USDC" });
```

Ethereum USDC (force chain when address is `0x`):
```js
const result = await money.send("0x1234...abcd", 25, { chain: "ethereum", token: "USDC" });
```

Arbitrum USDC:
```js
const result = await money.send("0x1234...abcd", 25, { chain: "arbitrum", token: "USDC" });
```

Solana SOL:
```js
const result = await money.send("7xKX...9pqR", 0.5);
```

Solana USDC:
```js
const result = await money.send("7xKX...9pqR", 10, { token: "USDC" });
```

**`send()` returns:**
```js
{ txHash: "0xabc...", explorerUrl: "https://...", fee: "0.001", chain: "base", network: "testnet" }
```

---

## §3 Check Balance

Single chain:
```js
const bal = await money.balance("fast");
console.log(bal.amount, bal.token);  // e.g. "42.5" "SET"
```

All configured chains at once:
```js
const all = await money.balance();
for (const b of all) console.log(b.chain, b.amount, b.token);
```

Specific token:
```js
const bal = await money.balance("base", { token: "USDC" });
```

---

## §4 Faucet (testnet only)

Get free tokens on testnet. **Not available on mainnet.**

```js
const result = await money.faucet("fast");
console.log(result.amount, result.token, result.txHash);

await money.faucet("solana");  // free SOL
```

If `faucet()` throws `TX_FAILED`, the faucet URL is in `e.details.faucetUrl`. Open it in a browser.

---

## §5 Error Recovery

Wrap every `send()` in try/catch. Use `.code` to decide what to do:

| `e.code` | What happened | What to do |
|---|---|---|
| `INSUFFICIENT_BALANCE` | Not enough tokens | Testnet: call `money.faucet(chain)`, then retry. Mainnet: fund the wallet. |
| `CHAIN_NOT_CONFIGURED` | No wallet for this chain | Call `money.setup(chain)`, then retry. |
| `TX_FAILED` | RPC or network error | Wait 5 seconds, retry once. If it fails again, log `e.message` and stop. |
| `INVALID_ADDRESS` | Bad address format | Do not retry. Check the address and ask the user to confirm it. |
| `TOKEN_NOT_FOUND` | Token alias not registered | Call `money.alias(chain, name, { address, decimals })`, then retry. |

Full example:
```js
try {
  const result = await money.send("set1qxy2kfcg...", 10);
} catch (e) {
  if (e.code === "INSUFFICIENT_BALANCE") {
    await money.faucet("fast");
    await money.send("set1qxy2kfcg...", 10);  // retry once
  } else if (e.code === "CHAIN_NOT_CONFIGURED") {
    await money.setup("fast");
    await money.send("set1qxy2kfcg...", 10);  // retry once
  } else if (e.code === "TX_FAILED") {
    await new Promise(r => setTimeout(r, 5000));
    await money.send("set1qxy2kfcg...", 10);  // retry once
  } else {
    throw e;  // INVALID_ADDRESS or TOKEN_NOT_FOUND — do not retry
  }
}
```

---

## §6 Idempotency — avoid double sends

Before sending, check if you already sent this payment:

```js
const history = await money.history("fast");
const already = history.find(
  e => e.to === recipientAddress && e.amount === String(amount)
);
if (already) {
  console.log("Already sent:", already.txHash);
} else {
  await money.send(recipientAddress, amount);
}
```

Each send is recorded in `~/.money/history.csv` as `{ ts, chain, network, to, amount, token, txHash }`.

---

## §7 Receiving Payments

**This SDK does not detect incoming payments.**

To check if tokens arrived, compare balance before and after:

```js
const before = await money.balance("fast");
// ... wait for the expected sender ...
const after = await money.balance("fast");
const received = parseFloat(after.amount) - parseFloat(before.amount);
if (received > 0) console.log("Received:", received, after.token);
```

For full incoming payment verification (confirmations, invoice matching), use a block explorer or an indexer — outside this SDK's scope.

---

## §8 Tokens and Aliases

**USDC is pre-registered** on Base, Ethereum, Arbitrum, and Solana after `setup()`. No extra steps needed.

Use USDC immediately:
```js
await money.send("0x1234...abcd", 25, { token: "USDC" });
```

**Raw token address** — decimals fetched on-chain automatically:
```js
// EVM ERC-20
await money.send("0x1234...abcd", 0.5, {
  token: "0x4200000000000000000000000000000000000006"
});

// Solana SPL mint
await money.send("7xKX...9pqR", 10, {
  token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
});
```

**Register a named alias (stored permanently in `~/.money/aliases.json`):**
```js
// EVM
await money.alias("base", "WETH", {
  address: "0x4200000000000000000000000000000000000006",
  decimals: 18
});

// Solana
await money.alias("solana", "USDT", {
  mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  decimals: 6
});
```

**Look up an alias:**
```js
const info = await money.alias("base", "WETH");
// { chain: "base", network: "testnet", name: "WETH", address: "0x42...", decimals: 18 }
```

**List all aliases for a chain:**
```js
const all = await money.aliases("base");
```

---

## §9 History

```js
const all    = await money.history();               // all chains, all time
const fast   = await money.history("fast");         // one chain
const recent = await money.history(undefined, 10);  // last 10 across all chains

// Each entry: { ts, chain, network, to, amount, token, txHash }
```

Stored locally in `~/.money/history.csv`. Not synced to the blockchain.

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

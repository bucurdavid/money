---
name: money
version: {{VERSION}}
description: >
  Send tokens on Fast, Base, Ethereum, Arbitrum, or Solana using the money skill.
  Use when asked to pay, transfer tokens, fund a wallet, or check a balance.
  Do NOT use for trading, DeFi, yield farming, price advice, or detecting incoming payments.
---

# MONEY SKILL

Everything works out of the box. RPCs, token addresses, explorer URLs — all built in for 5 chains, testnet and mainnet. You do not need API keys, ABIs, or config files.

## Install

```bash
mkdir -p ~/.money
curl -sL {{HOST}}/skill.md -o ~/.money/SKILL.md
curl -sL {{HOST}}/money.bundle.js -o ~/.money/money.bundle.js
curl -sL {{HOST}}/money.bundle.js.sha256 -o /tmp/money.sha256
(cd ~/.money && shasum -a 256 -c /tmp/money.sha256) && rm -f /tmp/money.sha256
```

Then symlink this into your auto-discovery skills path, or simply move the SKILL.md file there.

v{{VERSION}}. Two files. Integrity verified via SHA-256. No dependencies.

## Update

Before updating, back up the current skill file so you can diff for migrations:

```bash
VER=$(grep 'version:' ~/.money/SKILL.md | head -1 | awk '{print $2}') && cp ~/.money/SKILL.md ~/.money/SKILL.md.v${VER}.bak
```

Then re-run the install commands above. After updating, diff the old and new versions to check for breaking changes:

```bash
diff ~/.money/SKILL.md.v${VER}.bak ~/.money/SKILL.md
```

---

The entire skill is 3 steps:

```js
const { money } = await import(`${process.env.HOME}/.money/money.bundle.js`);
await money.setup({ chain: "fast" });                                          // 1. create wallet (once)
const bal = await money.balance({ chain: "fast" });                            // 2. check balance
const tx = await money.send({ to: "set1qxy...", amount: 10, chain: "fast" }); // 3. send tokens
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

1. **Default is testnet.** Never pass `network: "mainnet"` unless the user explicitly requested mainnet. If unsure, always use testnet. Mainnet uses real money.
2. **Sends are irreversible.** Verify the address before calling `send()`.
3. **Amounts are in human units.** `10` means 10 tokens, not 10 wei or 10 lamports.

---

## Setup

Call once per chain. Creates a wallet, stores RPC config. All defaults are built in — you only pass options to override.

```js
const { money } = await import(`${process.env.HOME}/.money/money.bundle.js`);

// testnet (default) — safe, faucet available, RPC built in
const w = await money.setup({ chain: "fast" });
// w = { chain: "fast", address: "set1...", network: "testnet", note: "Fund this wallet:\n  await money.faucet({ chain: \"fast\" })" }

// mainnet — real money, faucet disabled, optional custom RPC
const w = await money.setup({ chain: "base", network: "mainnet", rpc: "https://your-rpc-url" });
// w = { chain: "base", address: "0x...", network: "mainnet", note: "" }
```

Same call for every chain. Only the `chain` value changes. RPC is stored permanently — no need to pass it again.

**Mainnet requires explicit user consent.** Only call `setup({ network: "mainnet" })` when the user specifically asks for mainnet. When in doubt, confirm with the user first.

---

## Send Tokens

Chain is always required. Use `identifyChains()` if you don't know which chain an address belongs to.

| Address looks like | Chain | Default token |
|---|---|---|
| `set` prefix (bech32m, e.g. `set1abc...`) | Fast | SET |
| `0x` + 40 hex chars | Base, Ethereum, or Arbitrum | ETH |
| Base58, 32-44 chars | Solana | SOL |

```js
// Send native tokens
const tx = await money.send({ to: "set1qxy...", amount: 10, chain: "fast" });
// tx = { txHash, explorerUrl, fee, chain, network, note }

// Send on EVM — chain is always required
const tx = await money.send({ to: "0x1234...abcd", amount: 1.5, chain: "ethereum" });

// Send non-native token
const tx = await money.send({ to: "0x1234...abcd", amount: 25, chain: "base", token: "USDC" });

// Send on mainnet — requires prior setup with network: "mainnet"
const tx = await money.send({ to: "0x1234...abcd", amount: 1.5, chain: "ethereum", network: "mainnet" });
```

### Don't know the chain? Use identifyChains

```js
// Identify which chains an address format belongs to
const result = await money.identifyChains({ address: "0x1234...abcd" });
// result = { chains: ["base", "ethereum", "arbitrum"], note: "Multiple chains use this address format. Ask the user which chain to use." }
```

Solana works like Fast — native SOL by default. For SPL tokens pass the mint address or a registered token name as `token`.

---

## Check Balance

```js
const bal = await money.balance({ chain: "fast" });
// bal = { amount: "42.5", token: "SET", chain: "fast", network: "testnet", address: "set1...", note: "" }

// Check a specific token
const bal = await money.balance({ chain: "base", token: "USDC" });

// Check mainnet balance
const bal = await money.balance({ chain: "base", network: "mainnet" });
```

For balances across all configured chains, use `money.status()`.

---

## Faucet

Testnet only. Not available on mainnet.

```js
const r = await money.faucet({ chain: "fast" });
// r = { amount, token, txHash, chain, network, note: "Check balance:\n  await money.balance({ chain: \"fast\" })" }
```

If it throws `TX_FAILED`, the manual faucet URL is in `e.details.faucetUrl`.

---

## Error Recovery

All errors have `{ code, message, note }`. The `note` field contains a working code example showing how to fix the error.

| `e.code` | Meaning | Action |
|---|---|---|
| `INVALID_PARAMS` | Missing or invalid parameter | Read `e.note` for the correct call shape. |
| `INSUFFICIENT_BALANCE` | Not enough tokens | Testnet: `money.faucet({ chain })`, retry. Mainnet: fund wallet. |
| `CHAIN_NOT_CONFIGURED` | No wallet for chain | `money.setup({ chain })`, retry. |
| `TX_FAILED` | RPC/network error | Wait 5s, retry once. If still fails, stop. |
| `FAUCET_THROTTLED` | Faucet rate limited | Wait and retry later. |
| `INVALID_ADDRESS` | Bad address | Do not retry. Confirm address with user. |
| `TOKEN_NOT_FOUND` | Token not registered | `money.registerToken({ chain, name, address, decimals })`, retry. |

```js
try {
  await money.send({ to: "set1qxy...", amount: 10, chain: "fast" });
} catch (e) {
  // e.note contains a code example showing how to fix the error
  console.log(e.code, e.message, e.note);

  if (e.code === "INSUFFICIENT_BALANCE") {
    await money.faucet({ chain: "fast" });
    await money.send({ to: "set1qxy...", amount: 10, chain: "fast" });
  } else if (e.code === "CHAIN_NOT_CONFIGURED") {
    await money.setup({ chain: "fast" });
    await money.send({ to: "set1qxy...", amount: 10, chain: "fast" });
  } else if (e.code === "TX_FAILED") {
    await new Promise(r => setTimeout(r, 5000));
    await money.send({ to: "set1qxy...", amount: 10, chain: "fast" });
  } else {
    throw e;
  }
}
```

---

## Idempotency

Check history before sending to avoid double sends:

```js
const { entries } = await money.history({ chain: "fast" });
const already = entries.find(e => e.to === to && e.amount === String(amount));
if (already) {
  console.log("Already sent:", already.txHash);
} else {
  await money.send({ to, amount, chain: "fast" });
}
```

---

## Receiving

This skill does not detect incoming payments. Use balance delta as a proxy:

```js
const before = await money.balance({ chain: "fast" });
// ... wait ...
const after = await money.balance({ chain: "fast" });
const delta = parseFloat(after.amount) - parseFloat(before.amount);
if (delta > 0) console.log("Received:", delta, after.token);
```

For confirmed incoming verification, use a block explorer — outside this skill.

---

## Tokens

Native token works immediately after `setup()` — no configuration needed.

| Chain | Native token |
|---|---|
| Fast | SET |
| Base, Ethereum, Arbitrum | ETH |
| Solana | SOL |

For other tokens, register a named token once and use it by name forever:

```js
// Register a named token — separate registration per network (different contract addresses)
await money.registerToken({ chain: "base", name: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 });
await money.registerToken({ chain: "base", network: "mainnet", name: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 });

// Use by name — network selects the right contract address
await money.send({ to: "0x1234...abcd", amount: 25, chain: "base", token: "USDC" });
await money.send({ to: "0x1234...abcd", amount: 25, chain: "base", network: "mainnet", token: "USDC" });

// Look up or list tokens
const info = await money.getToken({ chain: "base", name: "USDC" });
const { tokens } = await money.tokens({ chain: "base" });
```

**Known USDC addresses:**

| Chain | Network | Address / Mint |
|---|---|---|
| Base | testnet | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base | mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Ethereum | testnet | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Ethereum | mainnet | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Arbitrum | testnet | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Arbitrum | mainnet | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Solana | testnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Solana | mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

---

## Custom Chains

Register any EVM-compatible chain (Polygon, Optimism, Avalanche, BSC, zkSync, etc.) and use it like a built-in chain.

```js
// Register a custom EVM chain (persistent — call once)
await money.registerEvmChain({
  chain: "polygon",
  chainId: 137,
  rpc: "https://polygon-rpc.com",
  explorer: "https://polygonscan.com/tx/",
  defaultToken: "MATIC",
  network: "mainnet",
});

// Then use it exactly like a built-in chain
await money.setup({ chain: "polygon", network: "mainnet" });
await money.balance({ chain: "polygon", network: "mainnet" });
await money.send({ to: "0x1234...abcd", amount: 1, chain: "polygon", network: "mainnet" });
```

All custom EVM chains share the same wallet key (`~/.money/keys/evm.json`) — same address across all EVM chains and networks.

Only `chainId` and `rpc` are required. `explorer`, `defaultToken` (defaults to `"ETH"`), and `network` (defaults to `"testnet"`) are optional.

Built-in chains (`fast`, `base`, `ethereum`, `arbitrum`, `solana`) cannot be overridden — use `money.setup()` for those.

---

## History

```js
const { entries } = await money.history();                          // all chains
const { entries } = await money.history({ chain: "fast" });         // one chain
const { entries } = await money.history({ limit: 5 });              // last 5
const { entries } = await money.history({ chain: "base", network: "mainnet" }); // mainnet only

// Each entry: { ts, chain, network, to, amount, token, txHash }
```

---

## Reference

| Method | Returns |
|--------|---------|
| `money.setup({ chain, network?, rpc? })` | `{ chain, address, network, note }` |
| `money.registerEvmChain({ chain, chainId, rpc, explorer?, defaultToken?, network? })` | `void` |
| `money.status()` | `{ entries: [...], note }` |
| `money.balance({ chain, network?, token? })` | `{ amount, token, chain, network, address, note }` |
| `money.send({ to, amount, chain, network?, token? })` | `{ txHash, explorerUrl, fee, chain, network, note }` |
| `money.faucet({ chain, network? })` | `{ amount, token, txHash, chain, network, note }` |
| `money.identifyChains({ address })` | `{ chains: string[], note }` |
| `money.getToken({ chain, network?, name })` | `TokenInfo` or `null` |
| `money.registerToken({ chain, network?, name, address?, mint?, decimals? })` | `void` |
| `money.tokens({ chain, network? })` | `{ tokens: TokenInfo[], note }` |
| `money.history({ chain?, network?, limit? })` | `{ entries: [...], note }` |

All errors: `{ code, message, note }`. The `note` field contains a code example showing how to fix the error.
`token` is optional. When omitted, the chain's native token is used: SET (Fast), ETH (Base/Ethereum/Arbitrum), SOL (Solana).

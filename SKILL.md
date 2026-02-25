---
name: money
description: >
  Universal payment SDK for AI agents. Send tokens, check balances, swap tokens, bridge cross-chain,
  look up prices, sign messages, list providers, and register custom EVM chains across 13 chains
  (Fast, Base, Ethereum, Arbitrum, Polygon, Optimism, BSC, Avalanche, Fantom, zkSync, Linea, Scroll, Solana)
  or any EVM chain.
  Use when asked to pay, transfer, swap, bridge, check price, sign a message, fund a wallet, check a balance,
  or list available providers.
  Do NOT use for yield farming, lending, staking, or detecting incoming payments.

---

# MONEY SKILL

Everything works out of the box — RPCs, token addresses, explorer URLs, all built in for 13 chains, testnet and mainnet. No API keys or config files needed.

## Install

```bash
mkdir -p ~/.money
curl -sL {{HOST}}/skill.md -o ~/.money/SKILL.md
curl -sL {{HOST}}/money.bundle.js -o ~/.money/money.bundle.js
curl -sL {{HOST}}/money.bundle.js.sha256 -o /tmp/money.sha256
(cd ~/.money && shasum -a 256 -c /tmp/money.sha256) && rm -f /tmp/money.sha256
```

v{{VERSION}}. Two files. Integrity verified via SHA-256. No dependencies.

---

## Quickstart

```js
const { money } = await import(`${process.env.HOME}/.money/money.bundle.js`);
await money.setup({ chain: "fast" });                                          // 1. create wallet (once)
const bal = await money.balance({ chain: "fast" });                            // 2. check balance
const tx = await money.send({ to: "set1qxy...", amount: 10, chain: "fast" }); // 3. send tokens
```

Same pattern on every chain. Only the chain name and address format change.

Supported chains: `"fast"` `"base"` `"ethereum"` `"arbitrum"` `"polygon"` `"optimism"` `"bsc"` `"avalanche"` `"fantom"` `"zksync"` `"linea"` `"scroll"` `"solana"`

## Discover All Methods

Call `money.help()` to list every method, or `money.describe("methodName")` for full details including params, result shape, examples, and notes. Both are synchronous.

```js
money.help();               // → [{ name, params, description }, ...]
money.describe("bridge");   // → { name, params, paramDetails, result, examples, notes }
money.describe("swap");     // → full details for swap
```

Use these instead of reading this entire document. The sections below cover **operational knowledge** that can't be discovered programmatically.

---

## Rules

1. **Default is testnet.** Never pass `network: "mainnet"` unless the user explicitly requested mainnet. If unsure, always use testnet. Mainnet uses real money.
2. **Sends are irreversible.** Verify the address before calling `send()`.
3. **Amounts are in human units.** `10` means 10 tokens, not 10 wei or 10 lamports.
4. **Mainnet requires explicit user consent.** Only call `setup({ network: "mainnet" })` when the user specifically asks.
5. **NEVER delete, overwrite, or modify files in `~/.money/keys/`.** These are wallet private keys. Loss means permanent, irreversible loss of funds. Do not run `rm`, `mv`, `cp`, `echo >`, or any command that could alter these files.

---

## Address Detection

Use `money.identifyChains({ address })` when you don't know the chain.

| Address looks like | Chain | Default token |
|---|---|---|
| `set1` prefix (bech32m) | Fast | SET |
| `0x` + 40 hex chars | Any EVM chain | ETH (or POL, BNB, AVAX, FTM) |
| Base58, 32-44 chars | Solana | SOL |

---

## Error Recovery

All errors have `{ code, message, note }`. Read `e.code` to decide action, `e.note` for a fix example.

| `e.code` | Action |
|---|---|
| `INSUFFICIENT_BALANCE` | Testnet: `money.faucet({ chain })`, retry. Mainnet: fund wallet. |
| `CHAIN_NOT_CONFIGURED` | `money.setup({ chain })`, retry. |
| `TX_FAILED` | Wait 5s, retry once. If still fails, stop. |
| `FAUCET_THROTTLED` | Wait and retry later. |
| `INVALID_ADDRESS` | Do not retry. Confirm address with user. |
| `TOKEN_NOT_FOUND` | `money.registerToken({ chain, name, address, decimals })`, retry. |
| `INVALID_PARAMS` | Read `e.note` for correct call shape. |
| `UNSUPPORTED_OPERATION` | Check `e.note` — method may not be available for this chain/network. |

---

## Idempotency

Check `money.history({ chain })` before sending to avoid double sends. Match on `to` + `amount`.

---

## Receiving

This skill cannot detect incoming payments. Compare balance before/after as a proxy.

---

## Key Concepts

### Network rules

- `swap`, `quote` require `network: "mainnet"` (testnet DEXes have no liquidity)
- `bridge` depends on provider: DeBridge requires `"mainnet"`, OmniSet requires `"testnet"`
- Solana swaps require a free Jupiter API key: `money.setApiKey({ provider: "jupiter", apiKey: "..." })`
- `price`, `tokenInfo` are read-only — work regardless of network

### Token discovery

`money.tokens({ chain })` returns **all** tokens you own: on-chain discovered tokens **plus** any registered aliases (including tokens auto-registered after a bridge). Use by name in `balance()`, `send()`, etc.

After `bridge()`, the destination token is auto-registered — call `tokens()` or `balance()` on the destination chain immediately.

### Token registration

For tokens not auto-discovered, register once:
```js
await money.registerToken({ chain: "base", name: "USDC", address: "0x036...", decimals: 6 });
```
Built-in tokens (USDC, USDT, WETH, WBTC, DAI) are hardcoded on mainnet — no registration needed.

### Providers

`money.providers()` lists all registered swap, bridge, and price providers with their supported chains and networks.

### Custom EVM chains

Register any EVM chain at runtime:
```js
await money.registerEvmChain({ chain: "celo", chainId: 42220, rpc: "https://forno.celo.org", defaultToken: "CELO", network: "mainnet" });
await money.setup({ chain: "celo", network: "mainnet" });
```

All EVM chains share the same wallet key — same address everywhere.

---

## NOT for this skill

Stop. Tell the user this skill cannot help with: yield farming, lending, staking, or detecting incoming payments from external senders.

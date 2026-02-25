---
name: money
version: {{VERSION}}
description: >
  Universal payment SDK for AI agents. Send tokens, check balances, swap tokens, bridge cross-chain,
  look up prices, sign messages, buy and sell crypto with fiat (via Transak),
  and register custom EVM chains across 13 chains (Fast, Base, Ethereum,
  Arbitrum, Polygon, Optimism, BSC, Avalanche, Fantom, zkSync, Linea, Scroll, Solana) or any EVM chain.
  Use when asked to pay, transfer, swap, bridge, check price, sign a message, fund a wallet, check a balance,
  or buy/sell crypto.
  Do NOT use for yield farming, lending, staking, or detecting incoming payments.
tags:
  - payments
  - blockchain
  - evm
  - solana
  - swap
  - bridge
  - wallet
  - fiat
  - transak
---

# MONEY SKILL

Everything works out of the box. RPCs, token addresses, explorer URLs — all built in for 13 chains, testnet and mainnet. Swap tokens via Jupiter (Solana) and Paraswap (EVM). Bridge cross-chain via DeBridge. Look up prices via DexScreener. Buy and sell crypto with fiat via Transak (zero config). Sign messages on any chain. Register any EVM chain at runtime. You do not need API keys or config files.

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

Supported chains: `"fast"` `"base"` `"ethereum"` `"arbitrum"` `"polygon"` `"optimism"` `"bsc"` `"avalanche"` `"fantom"` `"zksync"` `"linea"` `"scroll"` `"solana"`

## What do you want to do?

| Goal | Go to |
|------|-------|
| Set up a wallet | Setup |
| Send tokens | Send Tokens |
| Check balance | Check Balance |
| Swap tokens (e.g. SOL to USDC) | Swap |
| Bridge tokens cross-chain | Bridge |
| Look up token price | Price |
| Sign a message | Sign |
| Get free testnet tokens | Faucet |
| Handle an error | Error Recovery |
| Avoid sending twice | Idempotency |
| Check if you received tokens | Receiving |
| Use USDC or a custom token | Tokens |
| Convert between human and raw units | Unit Conversion |
| View past sends | History |
| Register a custom provider | Custom Providers |
| Export wallet private key | Export Keys |
| Configure API keys (e.g. Jupiter) | Swap |
| Buy crypto with fiat (on-ramp) | Buy & Sell Crypto |
| Sell crypto for fiat (off-ramp) | Buy & Sell Crypto |
| See all methods | Reference |

## NOT for this skill

Stop. Tell the user this skill cannot help with: yield farming, lending, staking, or detecting incoming payments from external senders.

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
| `0x` + 40 hex chars | Any EVM chain (Base, Ethereum, Arbitrum, Polygon, Optimism, BSC, Avalanche, Fantom, zkSync, Linea, Scroll) | ETH (or POL, BNB, AVAX, FTM depending on chain) |
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
| `UNSUPPORTED_OPERATION` | Method not available for chain | Use an EVM chain for contract calls. |

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

## Swap

Swap tokens on-chain. Uses Jupiter (Solana) and Paraswap (11 EVM chains) automatically. **Requires `network: "mainnet"` explicitly** — testnet DEXes have no liquidity.

ERC-20 token approvals are handled automatically — the SDK checks allowance and approves if needed before swapping. All transactions are confirmed on-chain before returning.

```js
// EVM swap (e.g. ETH to USDC on Base) — works immediately
const tx = await money.swap({ chain: "base", from: "ETH", to: "USDC", amount: 0.5, network: "mainnet" });
// tx = { txHash, explorerUrl, fromToken, toToken, fromAmount, toAmount, provider, chain, network, note }

// EVM swap with ERC-20 token (approval handled automatically)
const tx = await money.swap({ chain: "base", from: "USDC", to: "WETH", amount: 100, network: "mainnet" });

// Solana swap — requires one-time Jupiter API key setup (free at portal.jup.ag)
await money.setApiKey({ provider: "jupiter", apiKey: "your-free-key-from-portal.jup.ag" });
const tx = await money.swap({ chain: "solana", from: "SOL", to: "USDC", amount: 1, network: "mainnet" });

// Get a quote first (read-only, no transaction)
const q = await money.quote({ chain: "solana", from: "SOL", to: "USDC", amount: 1, network: "mainnet" });
// q = { fromToken, toToken, fromAmount, toAmount, rate, priceImpact, provider, chain, network, note }

// Custom slippage (default is 50 bps = 0.5%)
const tx = await money.swap({ chain: "base", from: "USDC", to: "WETH", amount: 100, network: "mainnet", slippageBps: 100 });
```

Known token symbols resolve automatically: USDC, USDT, WETH, WBTC, DAI, and native tokens (ETH, SOL, POL, BNB, AVAX, FTM). For other tokens, pass a contract address.

Supported swap chains: Solana (Jupiter), Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Avalanche, Fantom, zkSync, Linea, Scroll (Paraswap).

---

## Bridge

Bridge tokens between chains. Uses DeBridge DLN. **Requires `network: "mainnet"` explicitly.**

ERC-20 token approvals are handled automatically. Transactions are confirmed on-chain before the SDK returns — no phantom transaction hashes.

```js
// Bridge USDC from Ethereum to Base
const tx = await money.bridge({
  from: { chain: "ethereum", token: "USDC" },
  to: { chain: "base" },
  amount: 100,
  network: "mainnet",
});
// tx = { txHash, explorerUrl, fromChain, toChain, fromAmount, toAmount, orderId, estimatedTime, note }

// Bridge to a different address (default: your own address on the destination chain)
const tx = await money.bridge({
  from: { chain: "ethereum", token: "USDC" },
  to: { chain: "base", token: "USDC" },
  amount: 100,
  network: "mainnet",
  receiver: "0x1234...abcd",
});
```

Both source and destination chains must be set up first (`money.setup()`). If you don't provide `receiver`, the SDK uses your address on the destination chain.

Supported bridge chains: Ethereum, Optimism, BSC, Polygon, Base, Arbitrum, Avalanche, Linea, Fantom, Solana.

Note: Solana as bridge source is not yet supported (coming soon).

---

## Price

Look up token prices via DexScreener. No setup required. Works on testnet or mainnet — read-only.

```js
// Get price by symbol
const p = await money.price({ token: "ETH" });
// p = { price: "2500.00", symbol: "ETH", name: "Ethereum", priceChange24h: "2.5", volume24h: "50000000", liquidity: "10000000", marketCap: "300000000000", note }

// Get price by contract address on a specific chain
const p = await money.price({ token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chain: "ethereum" });

// Get detailed token info (includes DEX pairs)
const info = await money.tokenInfo({ token: "USDC", chain: "ethereum" });
// info = { name, symbol, address, price, priceChange24h, volume24h, liquidity, marketCap, pairs: [{ dex, pairAddress, quoteToken, price }], note }

// Use a custom price provider (must be registered first via registerPriceProvider)
const p = await money.price({ token: "BTC", provider: "my-oracle" });
```

The `note` field in price/tokenInfo responses includes a `money.registerToken()` hint so you can easily use the discovered token in balance/send calls.

---

## Sign

Sign a message with your wallet's private key. Useful for authentication (Sign-In with Ethereum), proving ownership, or off-chain attestations.

```js
// Sign on EVM (returns 0x-prefixed hex)
const sig = await money.sign({ chain: "base", message: "Sign in to MyApp" });
// sig = { signature: "0x...", address: "0x...", chain: "base", network: "testnet", note }

// Sign on Fast (returns hex)
const sig = await money.sign({ chain: "fast", message: "Hello world" });
// sig = { signature: "a1b2c3...", address: "set1...", chain: "fast", network: "testnet", note }

// Sign on Solana (returns base58)
const sig = await money.sign({ chain: "solana", message: "Verify me" });
// sig = { signature: "3xYz...", address: "7abc...", chain: "solana", network: "testnet", note }

// Sign raw bytes
const sig = await money.sign({ chain: "base", message: new Uint8Array([1, 2, 3]) });
```

---

## Export Keys

Export the wallet's private key and address. **Only use when the user explicitly asks to export or back up their keys.** The private key controls all funds on that wallet.

```js
// Export EVM key (same key for all EVM chains)
const k = await money.exportKeys({ chain: "base" });
// k = { address: "0x...", privateKey: "0x...", keyfile: "/home/user/.money/keys/evm.json", chain: "base", chainType: "evm", note: "WARNING: ..." }

// Export Solana key
const k = await money.exportKeys({ chain: "solana" });
// k = { address: "7abc...", privateKey: "a1b2c3...", keyfile: "/home/user/.money/keys/solana.json", chain: "solana", chainType: "solana", note: "WARNING: ..." }

// Export Fast key
const k = await money.exportKeys({ chain: "fast" });
// k = { address: "set1...", privateKey: "d4e5f6...", keyfile: "/home/user/.money/keys/fast.json", chain: "fast", chainType: "fast", note: "WARNING: ..." }
```

EVM private keys are returned with `0x` prefix (ready for import into MetaMask, etc.). Solana and Fast keys are hex-encoded.

All EVM chains share the same key — exporting from any EVM chain returns the same private key.

---

## Buy & Sell Crypto

Buy crypto with fiat (on-ramp) or sell crypto for fiat (off-ramp) via Transak. No API key needed. No configuration. The SDK generates a URL — give it to the user to complete the purchase or sale.

Transak handles identity verification, payment processing, and crypto delivery. Crypto is sent directly to the agent's wallet.

### On-Ramp: Buy crypto with fiat

```js
// Generate a buy link — user opens it to purchase USDC
const r = await money.onRamp({ chain: "base" });
// r = { url: "https://global.transak.com/?...", address: "0x...", provider: "transak", chain: "base", network: "testnet", note: "Open this URL to buy crypto..." }

// Specify amount and currency
const r = await money.onRamp({ chain: "base", amount: 100, currency: "USD" });

// Buy a different token
const r = await money.onRamp({ chain: "ethereum", token: "ETH", amount: 50, currency: "EUR" });

// Mainnet (real money)
const r = await money.onRamp({ chain: "base", amount: 100, network: "mainnet" });
```

After the user completes payment on Transak's page, crypto arrives in the wallet. Check with `money.balance()`.

### Off-Ramp: Sell crypto for fiat

```js
// Generate a sell link — user opens it to sell USDC
const r = await money.offRamp({ chain: "base" });
// r = { url: "https://global.transak.com/?...", address: "0x...", provider: "transak", chain: "base", network: "testnet", note: "Open this URL to sell crypto..." }

// Specify amount
const r = await money.offRamp({ chain: "base", amount: 50, currency: "EUR" });
```

The user completes the process on Transak's page, including sending crypto from their wallet and providing bank details for fiat payout.

Supported chains: Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Avalanche, Fantom, zkSync, Linea, Scroll, Solana.

---

## Tokens

Native token works immediately after `setup()` — no configuration needed.

| Chain | Native token |
|---|---|
| Fast | SET |
| Base, Ethereum, Arbitrum, Optimism, zkSync, Linea, Scroll | ETH |
| Polygon | POL |
| BSC | BNB |
| Avalanche | AVAX |
| Fantom | FTM |
| Solana | SOL |

Built-in tokens (USDC, USDT, WETH, WBTC, DAI) are hardcoded — no registration needed. For other tokens, register a named token once and use it by name forever (persists to `~/.money/aliases.json` across sessions):

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

Register any EVM-compatible chain not already built in, and use it like a built-in chain.

```js
// Register a custom EVM chain (persistent — call once)
await money.registerEvmChain({
  chain: "celo",
  chainId: 42220,
  rpc: "https://forno.celo.org",
  explorer: "https://explorer.celo.org/mainnet/tx/",
  defaultToken: "CELO",
  network: "mainnet",
});

// Then use it exactly like a built-in chain
await money.setup({ chain: "celo", network: "mainnet" });
await money.balance({ chain: "celo", network: "mainnet" });
await money.send({ to: "0x1234...abcd", amount: 1, chain: "celo", network: "mainnet" });
```

All custom EVM chains share the same wallet key (`~/.money/keys/evm.json`) — same address across all EVM chains and networks.

Only `chainId` and `rpc` are required. `explorer`, `defaultToken` (defaults to `"ETH"`), and `network` (defaults to `"testnet"`) are optional.

Built-in chains (`fast`, `base`, `ethereum`, `arbitrum`, `polygon`, `optimism`, `bsc`, `avalanche`, `fantom`, `zksync`, `linea`, `scroll`, `solana`) cannot be overridden — use `money.setup()` for those.

---

## Unit Conversion

Convert between human-readable amounts and raw blockchain units (wei, lamports, smallest denomination). Useful for contract call args and interpreting contract return values.

```js
// Human → raw (bigint)
const raw = await money.toRawUnits({ amount: 25, token: "USDC", chain: "base" });
// raw = 25000000n (USDC = 6 decimals)

const raw = await money.toRawUnits({ amount: 1.5, chain: "base" });
// raw = 1500000000000000000n (ETH = 18 decimals)

const raw = await money.toRawUnits({ amount: 100, decimals: 8 });
// raw = 10000000000n (explicit decimals, no chain lookup)

// Raw → human (string)
const human = await money.toHumanUnits({ amount: 25000000n, token: "USDC", chain: "base" });
// human = "25"

const human = await money.toHumanUnits({ amount: 1500000000000000000n, chain: "base" });
// human = "1.5"

const human = await money.toHumanUnits({ amount: 10000000000n, decimals: 8 });
// human = "100"
```

Two modes: **token lookup** (pass `chain` + optional `token` — decimals resolved from aliases or native token defaults) or **explicit decimals** (pass `decimals` directly — no chain needed).

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

## Custom Providers

Register custom swap, bridge, or price providers at runtime. Built-in providers (Jupiter, Paraswap, DeBridge, DexScreener) are registered automatically.

```js
// Register a custom swap provider
money.registerSwapProvider({
  name: "my-dex",
  chains: ["ethereum", "base"],
  async quote(params) { /* return SwapQuote */ },
  async swap(params) { /* return { txHash } */ },
});

// Register a custom bridge provider
money.registerBridgeProvider({
  name: "my-bridge",
  chains: ["ethereum", "base"],
  async bridge(params) { /* return { txHash, orderId?, estimatedTime? } */ },
});

// Register a custom price provider
money.registerPriceProvider({
  name: "my-oracle",
  async getPrice(params) { /* return { price, symbol, name, ... } */ },
  async getTokenInfo(params) { /* return { name, symbol, address, price, pairs, ... } */ },
});
```

Custom providers are used alongside built-ins. The SDK selects the first provider that supports the requested chain.

---

## Reference

| Method | Returns |
|--------|---------|
| `money.setup({ chain, network?, rpc? })` | `{ chain, address, network, note }` |
| `money.registerEvmChain({ chain, chainId, rpc, explorer?, defaultToken?, network? })` | `void` |
| `money.setApiKey({ provider, apiKey })` | `void` |
| `money.status()` | `{ entries: [...], note }` |
| `money.balance({ chain, network?, token? })` | `{ amount, token, chain, network, address, note }` |
| `money.send({ to, amount, chain, network?, token? })` | `{ txHash, explorerUrl, fee, chain, network, note }` |
| `money.faucet({ chain, network? })` | `{ amount, token, txHash, chain, network, note }` |
| `money.identifyChains({ address })` | `{ chains: string[], note }` |
| `money.exportKeys({ chain, network? })` | `{ address, privateKey, keyfile, chain, chainType, note }` |
| `money.sign({ chain, message, network? })` | `{ signature, address, chain, network, note }` |
| `money.quote({ chain, from, to, amount, network, slippageBps?, provider? })` | `{ fromToken, toToken, fromAmount, toAmount, rate, priceImpact, provider, chain, network, note }` |
| `money.swap({ chain, from, to, amount, network, slippageBps?, provider? })` | `{ txHash, explorerUrl, fromToken, toToken, fromAmount, toAmount, provider, chain, network, note }` |
| `money.price({ token, chain?, provider? })` | `{ price, symbol, name, priceChange24h?, volume24h?, liquidity?, marketCap?, chain?, note }` |
| `money.tokenInfo({ token, chain?, provider? })` | `{ name, symbol, address, price, pairs: [...], note }` |
| `money.bridge({ from: { chain, token }, to: { chain, token? }, amount, network, receiver?, provider? })` | `{ txHash, explorerUrl, fromChain, toChain, fromAmount, toAmount, orderId?, estimatedTime?, note }` |
| `money.getToken({ chain, network?, name })` | `TokenInfo` or `null` |
| `money.registerToken({ chain, network?, name, address?, mint?, decimals? })` | `void` |
| `money.tokens({ chain, network? })` | `{ tokens: TokenInfo[], note }` |
| `money.toRawUnits({ amount, chain?, network?, token?, decimals? })` | `bigint` |
| `money.toHumanUnits({ amount, chain?, network?, token?, decimals? })` | `string` |
| `money.history({ chain?, network?, limit? })` | `{ entries: [...], note }` |
| `money.registerSwapProvider(provider)` | `void` |
| `money.registerBridgeProvider(provider)` | `void` |
| `money.registerPriceProvider(provider)` | `void` |
| `money.onRamp({ chain, amount?, currency?, token?, network? })` | `{ url, address, provider, chain, network, note }` |
| `money.offRamp({ chain, amount?, currency?, token?, network? })` | `{ url, address, provider, chain, network, note }` |

All errors: `{ code, message, note }`. The `note` field contains a code example showing how to fix the error.

`token` is optional on send/balance. When omitted, the chain's native token is used: SET (Fast), ETH (Base/Ethereum/Arbitrum/Optimism/zkSync/Linea/Scroll), POL (Polygon), BNB (BSC), AVAX (Avalanche), FTM (Fantom), SOL (Solana).

Swap, quote, and bridge **require `network: "mainnet"` explicitly**. Price and tokenInfo are read-only and work regardless of network.

Solana swaps require a Jupiter API key (free at portal.jup.ag). Run `money.setApiKey({ provider: "jupiter", apiKey: "..." })` once before your first Solana swap.

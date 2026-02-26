# money

Universal payment SDK for AI agents. Send tokens, swap, bridge cross-chain, check prices, sign messages across 13 blockchain chains — or any custom EVM chain. RPCs, token addresses, explorer URLs all built in. Zero config required.

```js
const { money } = await import(`${process.env.HOME}/.money/money.bundle.js`);
await money.setup({ chain: "fast" });
await money.balance({ chain: "fast" });
await money.send({ to: "set1qxy...", amount: 10, chain: "fast" });
```

Same pattern on every chain. Only the chain name and address format change.

## Install

```bash
mkdir -p ~/.money
curl -sL https://money-alpha-khaki.vercel.app/skill.md -o ~/.money/SKILL.md
curl -sL https://money-alpha-khaki.vercel.app/money.bundle.js -o ~/.money/money.bundle.js
curl -sL https://money-alpha-khaki.vercel.app/money.bundle.js.sha256 -o /tmp/money.sha256
(cd ~/.money && shasum -a 256 -c /tmp/money.sha256) && rm -f /tmp/money.sha256
```

Two files. Integrity verified via SHA-256. No dependencies.

## Supported Chains

| Chain | Native Token | Testnet | Mainnet |
|-------|-------------|---------|---------|
| Fast | SET | testnet | — |
| Base | ETH | sepolia | mainnet |
| Ethereum | ETH | sepolia | mainnet |
| Arbitrum | ETH | sepolia | mainnet |
| Polygon | POL | amoy | mainnet |
| Optimism | ETH | sepolia | mainnet |
| BSC | BNB | testnet | mainnet |
| Avalanche | AVAX | fuji | mainnet |
| Fantom | FTM | testnet | mainnet |
| zkSync | ETH | sepolia | mainnet |
| Linea | ETH | sepolia | mainnet |
| Scroll | ETH | sepolia | mainnet |
| Solana | SOL | devnet | mainnet |

Default is always testnet. Opt in to mainnet explicitly:

```js
await money.setup({ chain: "base", network: "mainnet" });
```

All EVM chains share one wallet key — same address everywhere.

## Features

- **Send & receive** on all 13 chains (+ custom EVM chains)
- **Token swaps** via Jupiter (Solana) and Paraswap (EVM) — mainnet
- **Cross-chain bridging** via DeBridge (mainnet) and OmniSet (Fast<->EVM testnet)
- **Price lookups** via DexScreener and FastSet RPC
- **Token discovery** — `tokens()` returns on-chain balances + registered aliases
- **Bridge auto-registration** — destination tokens are auto-registered after bridging
- **Message signing & verification** across all chain types
- **Key export** for wallet backup/import
- **Self-describing API** — `help()`, `describe()`, `providers()` for runtime introspection
- **Custom EVM chains** — `registerEvmChain()` adds any EVM chain at runtime
- **Provider extensibility** — register custom swap, bridge, or price providers
- **Key protection** — `O_EXCL` prevents keyfile overwrite, automatic backups in `keys/backups/`

## API

All methods accept a single params object and return a result object. Call `money.help()` to list all methods, or `money.describe("methodName")` for full details.

### Wallet & Chain Management

| Method | Description |
|--------|-------------|
| `setup({ chain, network? })` | Create or load wallet for a chain |
| `balance({ chain, token?, network? })` | Check token balance |
| `address({ chain, network? })` | Get wallet address |
| `chains()` | List all configured chains with status |
| `faucet({ chain })` | Request testnet tokens |
| `exportKey({ chain })` | Export private key (handle with care) |

### Transfers

| Method | Description |
|--------|-------------|
| `send({ to, amount, chain, token?, network? })` | Send tokens |
| `history({ chain?, limit? })` | Transaction history |

### Swaps & Bridging

| Method | Description |
|--------|-------------|
| `swap({ chain, from, to, amount, network })` | Swap tokens (mainnet) |
| `quote({ chain, from, to, amount, network })` | Get swap quote without executing |
| `bridge({ from, to, amount, network? })` | Bridge tokens cross-chain |

### Discovery & Pricing

| Method | Description |
|--------|-------------|
| `tokens({ chain, network? })` | Discover all owned tokens (on-chain + aliases) |
| `price({ token, chain? })` | Look up token price in USD |
| `tokenInfo({ token, chain })` | Get token metadata |
| `identifyChains({ address })` | Detect which chains an address belongs to |

### Signing

| Method | Description |
|--------|-------------|
| `sign({ message, chain, network? })` | Sign a message |
| `verifySign({ message, signature, address, chain })` | Verify a signature |

### Configuration

| Method | Description |
|--------|-------------|
| `registerToken({ chain, name, address, decimals })` | Register a named token alias |
| `registerEvmChain({ chain, chainId, rpc, ... })` | Add a custom EVM chain |
| `setApiKey({ provider, apiKey })` | Set API key for a provider (e.g., Jupiter) |
| `registerSwapProvider(provider)` | Add a custom swap provider |
| `registerBridgeProvider(provider)` | Add a custom bridge provider |
| `registerPriceProvider(provider)` | Add a custom price provider |

### Introspection

| Method | Description |
|--------|-------------|
| `help()` | List all methods with params and descriptions |
| `describe(name)` | Full details for a method (params, result, examples, notes) |
| `providers()` | List all registered swap/bridge/price providers |

## Error Codes

Every error is a `MoneyError` with `.code`, `.message`, and `.note` (contains a fix example).

| Code | Meaning |
|------|---------|
| `INSUFFICIENT_BALANCE` | Not enough tokens to send |
| `CHAIN_NOT_CONFIGURED` | `setup()` not called for this chain |
| `TX_FAILED` | Transaction or RPC error |
| `FAUCET_THROTTLED` | Faucet rate-limited — wait and retry |
| `INVALID_ADDRESS` | Address format doesn't match chain |
| `TOKEN_NOT_FOUND` | Token not registered or discovered |
| `INVALID_PARAMS` | Missing or malformed parameters — read `e.note` |
| `UNSUPPORTED_OPERATION` | Not available for this chain/network |

## For AI Agents

See [SKILL.md](./SKILL.md) for agent-optimized instructions including error recovery, idempotency patterns, and operational knowledge. The SKILL.md is served with version interpolation at `/skill.md`.

## Development

```bash
npm run build:sdk                    # TypeScript -> dist/
npm run test                         # Run all tests (292 tests)
npm run bundle                       # Build ESM bundle + SHA-256 hash
npm run dev                          # Next.js dev server
npm run build                        # Next.js production build
```

Run a single test file:

```bash
npm run build:sdk && node --test --test-force-exit dist/tests/config.test.js
```

See [AGENTS.md](./AGENTS.md) for full coding guidelines, project layout, and conventions.

## Architecture

```
sdk/src/              Core SDK source (TypeScript, ESM)
  index.ts            Main SDK — all public methods
  schemas.ts          Zod schemas (single source of truth for all params/results)
  types.ts            Public types (z.infer re-exports)
  adapters/           Chain adapters (evm.ts, solana.ts, fast.ts)
  providers/          Service integrations (jupiter, paraswap, debridge, omniset, dexscreener)
sdk/tests/            Tests (Node.js built-in test runner)
app/                  Next.js app (landing page, SKILL.md route, bundle hash route)
public/               Static assets (money.bundle.js, SHA-256 hash)
SKILL.md              Agent-facing documentation
AGENTS.md             Developer coding guidelines
```

## License

UNLICENSED

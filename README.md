# money

Universal payment SDK for AI agents. RPCs, token addresses, and explorer URLs are built in for all 5 chains — testnet and mainnet. Zero config required.

```js
const { money } = await import('./money.bundle.js');
await money.setup("fast");               // create wallet
await money.balance("fast");            // check balance
await money.send("set1qxy2...", 10);    // send tokens
```

That pattern is identical on every chain. Only the chain name and address change.

## Install

```bash
mkdir -p ~/.openclaw/workspace/skills/money
curl -sL https://your-domain.com/skill.md \
  -o ~/.openclaw/workspace/skills/money/SKILL.md
curl -sL https://your-domain.com/money.bundle.js \
  -o ~/.openclaw/workspace/skills/money/money.bundle.js
```

Two files. No git, no npm, no build.

## Supported Chains

| Chain | Native Token | Testnet | Mainnet | Faucet |
|-------|-------------|---------|---------|--------|
| Fast | SET | ✅ (default) | ✅ | testnet only |
| Base | ETH | ✅ sepolia | ✅ | — |
| Ethereum | ETH | ✅ sepolia | ✅ | — |
| Arbitrum | ETH | ✅ sepolia | ✅ | — |
| Solana | SOL | ✅ devnet | ✅ | testnet only |

Testnet is always the default. Opt in to mainnet explicitly:

```js
await money.setup("base", { network: "mainnet" });
```

## Methods

| Method | Returns |
|--------|---------|
| `money.setup(chain, opts?)` | `{ chain, address, network }` |
| `money.balance(chain?, token?)` | `{ amount, token, chain, network, address }` or array |
| `money.send(to, amount, opts?)` | `{ txHash, explorerUrl, fee, chain, network }` |
| `money.faucet(chain)` | `{ amount, token, txHash, chain, network }` |
| `money.wallets()` | `[{ chain, network, address, balances }]` |
| `money.chains()` | `[{ chain, address, network, status }]` |
| `money.detect(address)` | `string` (chain name) or `null` |
| `money.history(chainOrLimit?, limit?)` | `[{ ts, chain, network, to, amount, token, txHash }]` |
| `money.alias(chain, name)` | `TokenInfo \| null` |
| `money.alias(chain, name, config)` | `null` |
| `money.aliases(chain)` | `TokenInfo[]` |

`opts` for `setup`: `{ network?: "testnet" | "mainnet", rpc?: string }`  
`opts` for `send`: `{ chain?: string, token?: string, memo?: string }`  
`config` for `alias`: `{ address?: string, mint?: string, decimals?: number }`

## Error Codes

Every error is a `MoneyError` with a `.code`:

| Code | Meaning |
|------|---------|
| `INSUFFICIENT_BALANCE` | Not enough tokens to send |
| `CHAIN_NOT_CONFIGURED` | `setup()` not called for this chain |
| `TX_FAILED` | RPC or network error |
| `INVALID_ADDRESS` | Address format doesn't match chain |
| `TOKEN_NOT_FOUND` | Token alias not registered |

## Tokens

Native token works immediately. For other tokens, pass the contract/mint address directly — decimals are fetched on-chain automatically. Or register a named alias once and reuse it:

```js
// Raw address — no registration needed
await money.send("0x1234...abcd", 0.5, { token: "0x4200000000000000000000000000000000000006" });

// Register an alias, then use by name
await money.alias("base", "USDC", { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 });
await money.send("0x1234...abcd", 25, { token: "USDC" });
```

## For AI Agents

See [SKILL.md](./SKILL.md) for agent-optimized instructions including decision routing, error recovery, and idempotency patterns.

## License

UNLICENSED — proprietary

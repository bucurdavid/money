# @fast/money

Universal payment SDK for AI agents. Send tokens on Fast, Base, Ethereum, Arbitrum, and Solana.

## Install

```
npm install @fast/money
```

## Usage

```js
import { money } from '@fast/money';

await money.setup("fast");
await money.faucet("fast");
await money.send("set1qxy2...", 10);
```

### Mainnet

```js
await money.setup("fast", { network: "mainnet" });
await money.send("set1qxy2...", 10);
```

Both testnet and mainnet configs coexist. Testnet is always the default.

## Tokens

USDC is automatically available on Base, Ethereum, Arbitrum, and Solana after `setup()`. No registration needed.

```js
// Use USDC directly
await money.send("0x1234...abcd", 25, { token: "USDC" });

// Pass any raw contract address without registration
await money.send("0x1234...abcd", 0.5, { token: "0x4200000000000000000000000000000000000006" });

// Or register a named alias
await money.alias("base", "WETH", { address: "0x4200000000000000000000000000000000000006", decimals: 18 });
await money.send("0x1234...abcd", 0.5, { token: "WETH" });

// Custom RPC
await money.setup("base", { network: "mainnet", rpc: "https://your-alchemy-url.com" });
```

## For AI Agents

See [SKILL.md](./SKILL.md) for agent-optimized instructions.

## Supported Chains

| Chain | Token | Testnet | Mainnet | Faucet |
|-------|-------|---------|---------|--------|
| Fast | SET | ✅ (default) | ✅ | testnet only |
| Base | USDC | ✅ sepolia (default) | ✅ | — |
| Ethereum | USDC | ✅ sepolia (default) | ✅ | — |
| Arbitrum | USDC | ✅ sepolia (default) | ✅ | — |
| Solana | SOL/USDC | ✅ devnet (default) | ✅ | testnet only |

## License

MIT

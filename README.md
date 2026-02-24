# @fast/money

Universal payment SDK for AI agents. Send and receive tokens on Fast, Base, Ethereum, Arbitrum, and Solana.

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

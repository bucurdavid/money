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

## For AI Agents

See [SKILL.md](./SKILL.md) for agent-optimized instructions.

## Supported Chains

| Chain | Token | Network | Faucet |
|-------|-------|---------|--------|
| Fast | SET | testnet | ✅ programmatic |
| Base | USDC | sepolia | manual |
| Ethereum | USDC | sepolia | manual |
| Arbitrum | USDC | sepolia | manual |
| Solana | SOL/USDC | devnet | ✅ programmatic |

## License

MIT

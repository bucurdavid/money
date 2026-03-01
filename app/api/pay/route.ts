import { headers } from 'next/headers';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

// Address validation patterns
const PATTERNS: Record<string, RegExp> = {
  fast: /^set1[a-z0-9]{38,}$/,
  evm: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

const CHAIN_PROTOCOLS: Record<string, string> = {
  fast: 'fast',
  base: 'evm',
  ethereum: 'evm',
  arbitrum: 'evm',
  polygon: 'evm',
  optimism: 'evm',
  bsc: 'evm',
  avalanche: 'evm',
  fantom: 'evm',
  zksync: 'evm',
  linea: 'evm',
  scroll: 'evm',
  solana: 'solana',
};

const NATIVE_TOKENS: Record<string, string> = {
  fast: 'SET',
  base: 'ETH',
  ethereum: 'ETH',
  arbitrum: 'ETH',
  polygon: 'POL',
  optimism: 'ETH',
  bsc: 'BNB',
  avalanche: 'AVAX',
  fantom: 'FTM',
  zksync: 'ETH',
  linea: 'ETH',
  scroll: 'ETH',
  solana: 'SOL',
};

const SUPPORTED_CHAINS = new Set(Object.keys(CHAIN_PROTOCOLS));

function generatePaymentId(): string {
  return 'pay_' + randomBytes(16).toString('hex');
}

function isValidAddress(address: string, chain: string): boolean {
  const protocol = CHAIN_PROTOCOLS[chain];
  if (!protocol) return false;
  const pattern = PATTERNS[protocol];
  if (!pattern) return false;
  return pattern.test(address);
}

function buildMarkdown(params: {
  paymentId: string;
  chain: string;
  network: string;
  receiver: string;
  amount: string;
  token: string;
  memo: string | null;
  expiresAt: string;
  createdAt: string;
  baseUrl: string;
}): string {
  const { paymentId, chain, network, receiver, amount, token, memo, expiresAt, createdAt, baseUrl } = params;

  const memoLine = memo ? '\n\n**Memo:** ' + memo : '';
  const memoFrontmatter = memo ?? '';
  const networkDisclaimer = network === 'testnet'
    ? 'This is a **testnet** payment request. No real funds will be transferred.'
    : 'This is a **mainnet** payment request. Real funds will be transferred.';

  const frontmatter = [
    '---',
    'type: payment_request',
    'version: "2.0"',
    'payment_id: "' + paymentId + '"',
    'chain: "' + chain + '"',
    'network: "' + network + '"',
    'receiver: "' + receiver + '"',
    'amount: "' + amount + '"',
    'token: "' + token + '"',
    'memo: "' + memoFrontmatter + '"',
    'expires_at: "' + expiresAt + '"',
    'created_at: "' + createdAt + '"',
    'skill: "' + baseUrl + '/skill.md"',
    '---',
  ].join('\n');

  const setupBlock = [
    '```bash',
    'mkdir -p ~/.money',
    'curl -sL ' + baseUrl + '/skill.md -o ~/.money/SKILL.md',
    'curl -sL ' + baseUrl + '/money.bundle.js -o ~/.money/money.bundle.js',
    'curl -sL ' + baseUrl + '/money.bundle.js.sha256 -o /tmp/money.sha256',
    '(cd ~/.money && shasum -a 256 -c /tmp/money.sha256) && rm -f /tmp/money.sha256',
    '```',
  ].join('\n');

  const payBlock = [
    '```js',
    'const { money } = await import(`${process.env.HOME}/.money/money.bundle.js`);',
    'await money.setup({ chain: "' + chain + '", network: "' + network + '" });',
    'await money.send({',
    '  to: "' + receiver + '",',
    '  amount: ' + amount + ',',
    '  chain: "' + chain + '",',
    '  token: "' + token + '",',
    '  network: "' + network + '",',
    '  payment_id: "' + paymentId + '",',
    '});',
    '```',
  ].join('\n');

  return [
    frontmatter,
    '',
    '# Payment Request \u2014 ' + amount + ' ' + token + ' on ' + chain,
    '',
    'Send **' + amount + ' ' + token + '** to `' + receiver + '` on **' + chain + '** (' + network + ').' + memoLine,
    '',
    '## Setup',
    '',
    'If you don\'t have the money skill installed:',
    '',
    setupBlock,
    '',
    '## Pay',
    '',
    payBlock,
    '',
    '> ' + networkDisclaimer + ' Expires: ' + expiresAt,
  ].join('\n');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const receiver = searchParams.get('receiver');
  const amount = searchParams.get('amount');
  const chain = searchParams.get('chain');
  const token = searchParams.get('token');
  const network = searchParams.get('network') ?? 'testnet';
  const memo = searchParams.get('memo');

  // Validate required params
  if (!receiver) {
    return Response.json({ error: 'Missing required param: receiver' }, { status: 400 });
  }
  if (!amount) {
    return Response.json({ error: 'Missing required param: amount' }, { status: 400 });
  }
  if (!chain) {
    return Response.json({ error: 'Missing required param: chain' }, { status: 400 });
  }

  // Validate chain
  if (!SUPPORTED_CHAINS.has(chain)) {
    return Response.json(
      { error: 'Unsupported chain: ' + chain + '. Supported: ' + [...SUPPORTED_CHAINS].join(', ') },
      { status: 400 },
    );
  }

  // Validate address
  if (!isValidAddress(receiver, chain)) {
    return Response.json(
      { error: 'Invalid receiver address for chain ' + chain },
      { status: 400 },
    );
  }

  // Validate amount
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return Response.json({ error: 'Amount must be a positive number' }, { status: 400 });
  }

  // Validate network
  if (network !== 'testnet' && network !== 'mainnet') {
    return Response.json({ error: 'Network must be "testnet" or "mainnet"' }, { status: 400 });
  }

  // Resolve token
  const resolvedToken = token ?? NATIVE_TOKENS[chain];

  // Generate IDs and timestamps
  const paymentId = generatePaymentId();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Derive base URL from request headers
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = protocol + '://' + host;

  const markdown = buildMarkdown({
    paymentId,
    chain,
    network,
    receiver,
    amount,
    token: resolvedToken,
    memo,
    expiresAt,
    createdAt,
    baseUrl,
  });

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Payment-Id': paymentId,
    },
  });
}

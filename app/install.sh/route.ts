import { headers } from 'next/headers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const host = (await headers()).get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const origin = `${protocol}://${host}`;
  const version = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
  ).version;

  const script = `#!/bin/sh
set -e
DIR="$HOME/.config/opencode/skills/money"
HOST="${origin}"
mkdir -p "$DIR"
curl -sL "$HOST/skill.md" -o "$DIR/SKILL.md"
curl -sL "$HOST/money.bundle.js" -o "$DIR/money.bundle.js"
curl -sL "$HOST/money.bundle.js.sha256" -o /tmp/money.sha256
(cd "$DIR" && shasum -a 256 -c /tmp/money.sha256)
rm -f /tmp/money.sha256
echo "money v${version} installed to $DIR"
`;

  return new Response(script, {
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

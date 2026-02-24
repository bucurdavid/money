import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function GET() {
  const buffer = readFileSync(join(process.cwd(), 'public', 'money.bundle.js'));
  const hash = createHash('sha256').update(buffer).digest('hex');
  const content = `${hash}  money.bundle.js\n`;
  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

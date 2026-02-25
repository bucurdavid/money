import { verifyMessage } from 'viem';

export interface AuthResult {
  valid: boolean;
  address?: string;
  error?: string;
}

export async function verifyWalletAuth(request: Request): Promise<AuthResult> {
  const address = request.headers.get('X-Wallet-Address');
  const signature = request.headers.get('X-Wallet-Signature');
  const timestamp = request.headers.get('X-Wallet-Timestamp');

  if (!address || !signature || !timestamp) {
    return { valid: false, error: 'Missing auth headers: X-Wallet-Address, X-Wallet-Signature, X-Wallet-Timestamp' };
  }

  // Check timestamp freshness (reject if >60s old)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > 60) {
    return { valid: false, error: 'Timestamp expired or invalid' };
  }

  // Verify signature
  const message = `money-fiat:${timestamp}`;
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }
    return { valid: true, address };
  } catch {
    return { valid: false, error: 'Signature verification failed' };
  }
}

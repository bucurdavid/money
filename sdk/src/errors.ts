/**
 * errors.ts — Structured error codes for money SDK.
 *
 * Every throwable error from the SDK is a MoneyError with a machine-readable
 * `code`, optional `chain`, and optional `details` bag. Agents can switch on
 * `code` instead of parsing message strings.
 */

export type MoneyErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'CHAIN_NOT_CONFIGURED'
  | 'TX_FAILED'
  | 'FAUCET_THROTTLED'
  | 'INVALID_ADDRESS'
  | 'TOKEN_NOT_FOUND';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  readonly chain?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: MoneyErrorCode,
    message: string,
    opts?: { chain?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
    this.chain = opts?.chain;
    this.details = opts?.details;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      chain: this.chain,
      details: this.details,
    };
  }
}

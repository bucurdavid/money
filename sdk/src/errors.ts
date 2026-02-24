/**
 * errors.ts — Structured error codes for money skill.
 *
 * Every throwable error from the skill is a MoneyError with a machine-readable
 * `code`, optional `chain`, and optional `details` bag. Agents can switch on
 * `code` instead of parsing message strings.
 */

export type MoneyErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'CHAIN_NOT_CONFIGURED'
  | 'TX_FAILED'
  | 'FAUCET_THROTTLED'
  | 'INVALID_ADDRESS'
  | 'TOKEN_NOT_FOUND'
  | 'CONTACT_NOT_FOUND'
  | 'INVALID_PARAMS';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  readonly chain?: string;
  readonly details?: Record<string, unknown>;
  readonly note: string;

  constructor(
    code: MoneyErrorCode,
    message: string,
    opts?: { chain?: string; details?: Record<string, unknown>; note?: string },
  ) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
    this.chain = opts?.chain;
    this.details = opts?.details;
    this.note = opts?.note ?? '';
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      note: this.note,
      chain: this.chain,
      details: this.details,
    };
  }
}

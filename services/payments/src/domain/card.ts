import { randomBytes } from 'node:crypto';
import { type PaymentOutcome, TEST_CARDS } from '@stockroom/contracts';

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function detectBrand(digits: string): string {
  if (digits.startsWith('4')) return 'visa';
  const two = Number(digits.slice(0, 2));
  const four = Number(digits.slice(0, 4));
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'mastercard';
  if (two === 34 || two === 37) return 'amex';
  return 'unknown';
}

export function isExpired(expMonth: number, expYear: number, now: Date): boolean {
  return expYear * 12 + expMonth < now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
}

export function simulatedOutcome(digits: string): { outcome: PaymentOutcome; declineReason: string | null } {
  const card = TEST_CARDS.find((candidate) => candidate.number === digits);
  return card ? { outcome: card.outcome, declineReason: card.declineReason } : { outcome: 'APPROVE', declineReason: null };
}

export type ChargeDecision = { status: 'SUCCEEDED' } | { status: 'FAILED'; reason: string };

export function decideCharge(
  method: { outcome: PaymentOutcome; declineReason: string | null; expiresAt: Date } | null,
  amountCents: number,
  limitCents: number,
  now: Date,
): ChargeDecision {
  if (!method || method.expiresAt.getTime() < now.getTime()) return { status: 'FAILED', reason: 'INVALID_PAYMENT_METHOD' };
  if (amountCents > limitCents) return { status: 'FAILED', reason: 'LIMIT_EXCEEDED' };
  if (method.outcome === 'DECLINE') return { status: 'FAILED', reason: method.declineReason ?? 'CARD_DECLINED' };
  return { status: 'SUCCEEDED' };
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newPaymentMethodId(): string {
  const bytes = randomBytes(24);
  let id = 'pm_';
  for (const byte of bytes) id += BASE62[byte % 62];
  return id;
}

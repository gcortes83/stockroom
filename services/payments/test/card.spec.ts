import { describe, expect, it } from 'vitest';
import { TEST_CARDS } from '@stockroom/contracts';
import { decideCharge, detectBrand, isExpired, newPaymentMethodId, passesLuhn, simulatedOutcome } from '../src/domain/card';

const now = new Date('2026-10-05T16:00:00.000Z');
const later = new Date('2026-10-05T16:30:00.000Z');

describe('card rules', () => {
  it('validates every test card with Luhn and rejects a typo', () => {
    for (const card of TEST_CARDS) expect(passesLuhn(card.number)).toBe(true);
    expect(passesLuhn('4242424242424241')).toBe(false);
  });

  it('detects brands', () => {
    expect(detectBrand('4242424242424242')).toBe('visa');
    expect(detectBrand('5555555555554444')).toBe('mastercard');
    expect(detectBrand('2223003122003222')).toBe('mastercard');
    expect(detectBrand('378282246310005')).toBe('amex');
    expect(detectBrand('6011111111111117')).toBe('unknown');
  });

  it('treats the current month as not expired', () => {
    expect(isExpired(10, 2026, now)).toBe(false);
    expect(isExpired(9, 2026, now)).toBe(true);
  });

  it('maps test cards to simulated outcomes', () => {
    expect(simulatedOutcome('4242424242424242')).toEqual({ outcome: 'APPROVE', declineReason: null });
    expect(simulatedOutcome('4000000000000002')).toEqual({ outcome: 'DECLINE', declineReason: 'CARD_DECLINED' });
    expect(simulatedOutcome('4000000000009995')).toEqual({ outcome: 'DECLINE', declineReason: 'INSUFFICIENT_FUNDS' });
    expect(simulatedOutcome('4000000000000119').outcome).toBe('FAIL_ONCE');
    expect(simulatedOutcome('5555555555554444').outcome).toBe('APPROVE');
  });

  it('generates payment method ids with the documented format', () => {
    expect(newPaymentMethodId()).toMatch(/^pm_[A-Za-z0-9]{24}$/);
  });
});

describe('decideCharge', () => {
  const approve = { outcome: 'APPROVE' as const, declineReason: null, expiresAt: later };

  it('approves a valid method under the limit', () => {
    expect(decideCharge(approve, 1999, 1_000_000, now)).toEqual({ status: 'SUCCEEDED' });
  });

  it('declines above the limit', () => {
    expect(decideCharge(approve, 1_000_001, 1_000_000, now)).toEqual({ status: 'FAILED', reason: 'LIMIT_EXCEEDED' });
  });

  it('fails for missing or expired tokens', () => {
    expect(decideCharge(null, 1, 1_000_000, now)).toEqual({ status: 'FAILED', reason: 'INVALID_PAYMENT_METHOD' });
    expect(decideCharge({ ...approve, expiresAt: new Date('2026-10-05T15:00:00.000Z') }, 1, 1_000_000, now)).toEqual({
      status: 'FAILED',
      reason: 'INVALID_PAYMENT_METHOD',
    });
  });

  it('uses the decline reason of declining cards', () => {
    expect(decideCharge({ outcome: 'DECLINE', declineReason: 'INSUFFICIENT_FUNDS', expiresAt: later }, 1, 1_000_000, now)).toEqual({
      status: 'FAILED',
      reason: 'INSUFFICIENT_FUNDS',
    });
  });
});

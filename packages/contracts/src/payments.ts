import { z } from 'zod';

export const PAYMENT_OUTCOMES = ['APPROVE', 'DECLINE', 'FAIL_ONCE'] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export const TEST_CARDS = [
  { number: '4242424242424242', outcome: 'APPROVE', label: 'Approved', declineReason: null },
  { number: '4000000000000002', outcome: 'DECLINE', label: 'Card declined', declineReason: 'CARD_DECLINED' },
  { number: '4000000000009995', outcome: 'DECLINE', label: 'Insufficient funds', declineReason: 'INSUFFICIENT_FUNDS' },
  { number: '4000000000000119', outcome: 'FAIL_ONCE', label: 'Processing error, then approved', declineReason: null },
] as const;

export const PAYMENT_LIMIT_CENTS = 1_000_000;

export const createPaymentMethodSchema = z.strictObject({
  cardNumber: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{13,19}$/, 'Card number must have 13 to 19 digits')),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/, 'CVC must have 3 or 4 digits'),
  holderName: z.string().trim().min(1, 'Cardholder name is required').max(120),
});
export type CreatePaymentMethodInput = z.input<typeof createPaymentMethodSchema>;

export const paymentMethodSchema = z.object({
  id: z.string(),
  brand: z.string(),
  last4: z.string(),
  expMonth: z.number().int(),
  expYear: z.number().int(),
  expiresAt: z.string(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_METHOD_ID_PATTERN = /^pm_[A-Za-z0-9]{24}$/;

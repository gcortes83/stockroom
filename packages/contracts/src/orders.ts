import { z } from 'zod';
import { moneySchema } from './common';
import { PAYMENT_METHOD_ID_PATTERN } from './payments';

export const ORDER_STATUSES = ['PENDING', 'AWAITING_PAYMENT', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['CONFIRMED', 'CANCELLED'];

export const CANCEL_REASONS = ['OUT_OF_STOCK', 'PAYMENT_DECLINED', 'RESERVATION_EXPIRED', 'STOCK_COMMIT_FAILED'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 99;

export const placeOrderSchema = z.strictObject({
  customer: z.strictObject({
    name: z.string().trim().min(1, 'Name is required').max(120),
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  }),
  lines: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
      }),
    )
    .min(1, 'Order must have at least one line')
    .max(MAX_ORDER_LINES)
    .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
      message: 'Each product can appear only once',
    }),
  paymentMethodId: z.string().regex(PAYMENT_METHOD_ID_PATTERN, 'Invalid payment method'),
  expectedTotalCents: z.number().int().min(0).optional(),
});
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;
export type PlaceOrder = z.output<typeof placeOrderSchema>;

export const orderLineSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  name: z.string(),
  unitPrice: moneySchema,
  quantity: z.number().int(),
  lineTotal: moneySchema,
});

export const orderSchema = z.object({
  id: z.string(),
  status: z.enum(ORDER_STATUSES),
  customer: z.object({ name: z.string(), email: z.string() }),
  lines: z.array(orderLineSchema),
  total: moneySchema,
  payment: z
    .object({
      status: z.enum(['SUCCEEDED', 'FAILED', 'REFUNDED']),
      last4: z.string().nullable(),
      declineReason: z.string().nullable(),
    })
    .nullable(),
  cancellation: z.object({ reason: z.enum(CANCEL_REASONS), detail: z.unknown().nullable() }).nullable(),
  history: z.array(
    z.object({
      from: z.enum(ORDER_STATUSES).nullable(),
      to: z.enum(ORDER_STATUSES),
      reason: z.string().nullable(),
      at: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderSummarySchema = z.object({
  id: z.string(),
  status: z.enum(ORDER_STATUSES),
  total: moneySchema,
  customerEmail: z.string(),
  lineCount: z.number().int(),
  createdAt: z.string(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

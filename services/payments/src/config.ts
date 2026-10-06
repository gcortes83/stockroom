import { z } from 'zod';
import { PAYMENT_LIMIT_CENTS } from '@stockroom/contracts';
import { infraConfigSchema, loadConfig } from '@stockroom/platform';

export const paymentsConfigSchema = infraConfigSchema.extend({
  PORT: z.coerce.number().int().positive().default(3003),
  PAYMENT_METHOD_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  PAYMENT_SIMULATED_LATENCY_MS: z.coerce.number().int().min(0).default(800),
  PAYMENT_LIMIT_CENTS: z.coerce.number().int().positive().default(PAYMENT_LIMIT_CENTS),
});

export type PaymentsConfig = z.output<typeof paymentsConfigSchema>;

export const PAYMENTS_CONFIG = 'PAYMENTS_CONFIG';

export const loadPaymentsConfig = (): PaymentsConfig => loadConfig(paymentsConfigSchema);

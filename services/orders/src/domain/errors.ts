import { ConflictError, DomainError, NotFoundError } from '@stockroom/platform';

export const orderNotFound = (id: string) => new NotFoundError('ORDER_NOT_FOUND', `Order ${id} was not found`);

export const idempotencyKeyRequired = () =>
  new DomainError('IDEMPOTENCY_KEY_REQUIRED', 428, 'The Idempotency-Key header (a UUID) is required');

export const idempotencyKeyInvalid = () =>
  new DomainError('VALIDATION', 400, 'The Idempotency-Key header must be a UUID', {
    errors: [{ path: 'Idempotency-Key', message: 'Must be a UUID' }],
  });

export const idempotencyKeyReused = () =>
  new DomainError('IDEMPOTENCY_KEY_REUSED', 422, 'This Idempotency-Key was already used with a different request body');

export const catalogUnavailable = () =>
  new DomainError('CATALOG_UNAVAILABLE', 503, 'The catalog is temporarily unavailable. Please try again shortly.');

export const productUnavailable = (productIds: string[]) =>
  new ConflictError('PRODUCT_UNAVAILABLE', 'Some products are no longer available', { productIds });

export const insufficientStock = (lines: { productId: string; sku: string; requested: number; available: number }[]) =>
  new ConflictError('INSUFFICIENT_STOCK', 'Not enough stock for some products', { lines });

export const priceChanged = (
  lines: { productId: string; sku: string; unitPriceCents: number }[],
  totalCents: number,
) => new ConflictError('PRICE_CHANGED', 'Prices changed since the cart was built. Review the new total.', { lines, totalCents });

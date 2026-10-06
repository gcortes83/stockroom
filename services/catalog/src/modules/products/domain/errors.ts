import { ConflictError, DomainError, NotFoundError } from '@stockroom/platform';

export const productNotFound = (id: string) => new NotFoundError('PRODUCT_NOT_FOUND', `Product ${id} was not found`);

export const duplicateSku = (sku: string) =>
  new ConflictError('DUPLICATE_SKU', `A product with SKU ${sku} already exists`, { sku });

export const versionConflict = (currentVersion: number) =>
  new ConflictError('VERSION_CONFLICT', 'The product was modified by someone else. Reload and try again.', {
    currentVersion,
  });

export const stockBelowReserved = (reserved: number) =>
  new ConflictError('STOCK_BELOW_RESERVED', `Stock cannot be lower than the ${reserved} units reserved by open orders`, {
    reserved,
  });

export const productHasReservations = (reserved: number) =>
  new ConflictError(
    'PRODUCT_HAS_ACTIVE_RESERVATIONS',
    `The product has ${reserved} units reserved by orders in progress. Try again later.`,
    { reserved },
  );

export const preconditionRequired = () =>
  new DomainError('PRECONDITION_REQUIRED', 428, 'The If-Match header with the product version is required');

export function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  return match ? Number(match[1]) : null;
}

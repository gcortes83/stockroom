import { type APIRequestContext, expect, type Page } from '@playwright/test';

export const uniqueSku = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`.toUpperCase();

export type CreatedProduct = { id: string; sku: string; name: string; version: number };

export async function createProduct(
  request: APIRequestContext,
  overrides: Partial<{ sku: string; name: string; category: string; priceCents: number; stock: number }> = {},
): Promise<CreatedProduct> {
  const sku = overrides.sku ?? uniqueSku('E2E');
  const response = await request.post('/api/v1/products', {
    data: {
      sku,
      name: `E2E Product ${sku}`,
      category: 'Home & Office',
      priceCents: 1250,
      stock: 5,
      description: 'Created by Playwright',
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as CreatedProduct;
}

export function failOnDialogs(page: Page): void {
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`Unexpected browser dialog: ${dialog.message()}`);
  });
}

export async function fillCheckout(page: Page, cardNumber: string): Promise<void> {
  await page.getByLabel('Full name').fill('Playwright Shopper');
  await page.getByLabel('Email').fill('e2e@example.com');
  await page.getByLabel('Card number').fill(cardNumber);
  await page.getByLabel('Expiry').fill('1230');
  await page.getByLabel('CVC').fill('123');
}

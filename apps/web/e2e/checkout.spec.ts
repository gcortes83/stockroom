import { expect, test } from '@playwright/test';
import { createProduct, fillCheckout } from './support';

test.describe('Purchase', () => {
  test('confirms an order paid with an approved card and decrements stock', async ({ page, request }) => {
    const product = await createProduct(request, { stock: 3 });
    await page.goto(`/shop/products/${product.id}`);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.goto('/shop/checkout');
    await fillCheckout(page, '4242424242424242');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page).toHaveURL(/\/shop\/orders\//);
    await expect(page.getByRole('heading', { name: /Order confirmed/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Card •••• 4242')).toBeVisible();
    const after = await (await request.get(`/api/v1/products/${product.id}`)).json();
    expect(after).toMatchObject({ stock: 2, reserved: 0 });
  });

  test('cancels an order when the card is declined and releases the stock', async ({ page, request }) => {
    const product = await createProduct(request, { stock: 1 });
    await page.goto(`/shop/products/${product.id}`);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.goto('/shop/checkout');
    await fillCheckout(page, '4000000000000002');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Order cancelled' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('The card was declined by the issuer.')).toBeVisible();
    const after = await (await request.get(`/api/v1/products/${product.id}`)).json();
    expect(after).toMatchObject({ stock: 1, reserved: 0 });
  });

  test('marks sold-out products as unavailable', async ({ page, request }) => {
    const product = await createProduct(request, { stock: 0 });
    await page.goto(`/shop/products/${product.id}`);
    await expect(page.getByRole('button', { name: 'Out of stock' })).toBeDisabled();
  });

  test('asks the shopper to review when a price changed after adding to cart', async ({ page, request }) => {
    const product = await createProduct(request, { stock: 3, priceCents: 1000 });
    await page.goto(`/shop/products/${product.id}`);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    const update = await request.put(`/api/v1/products/${product.id}`, {
      headers: { 'if-match': '"1"' },
      data: { name: product.name, category: 'Home & Office', priceCents: 1500, stock: 3, description: 'Created by Playwright' },
    });
    expect(update.status()).toBe(200);
    await page.goto('/shop/checkout');
    await fillCheckout(page, '4242424242424242');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText('Some prices changed. Review the new total and place the order again.')).toBeVisible();
    await expect(page.getByText('$15.00').first()).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: /Order confirmed/ })).toBeVisible({ timeout: 20_000 });
  });
});

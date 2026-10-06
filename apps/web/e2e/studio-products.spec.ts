import { expect, test } from '@playwright/test';
import { createProduct, uniqueSku } from './support';

test.describe('Studio products', () => {
  test('creates, edits and deletes a product through the UI', async ({ page }) => {
    const sku = uniqueSku('UI');
    await page.goto('/admin/products/new');
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Category').fill('Stationery');
    await page.getByLabel('Name', { exact: true }).fill(`Playwright Notebook ${sku}`);
    await page.getByLabel('Description').fill('A5, dotted');
    await page.getByLabel('Price (USD)').fill('6.50');
    await page.getByLabel('Stock', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    await page.getByLabel('Search products').fill(sku);
    const row = page.getByRole('row', { name: new RegExp(sku) });
    await expect(row).toContainText('$6.50');

    await row.getByRole('link', { name: /Edit/ }).click();
    await page.getByLabel('Price (USD)').fill('7.25');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await page.getByLabel('Search products').fill(sku);
    await expect(page.getByRole('row', { name: new RegExp(sku) })).toContainText('$7.25');

    await page
      .getByRole('row', { name: new RegExp(sku) })
      .getByRole('button', { name: /Delete/ })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No products match')).toBeVisible();
  });

  test('shows validation errors next to the fields', async ({ page }) => {
    await page.goto('/admin/products/new');
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByText('SKU is required')).toBeVisible();
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByText('Enter a price like 19.99')).toBeVisible();
  });

  test('detects a concurrent edit and offers to reload while keeping changes', async ({
    browser,
    request,
  }) => {
    const product = await createProduct(request);
    const first = await (await browser.newContext()).newPage();
    const second = await (await browser.newContext()).newPage();
    await first.goto(`/admin/products/${product.id}/edit`);
    await second.goto(`/admin/products/${product.id}/edit`);
    await expect(first.getByLabel('Price (USD)')).toHaveValue('12.50');
    await expect(second.getByLabel('Price (USD)')).toHaveValue('12.50');

    await first.getByLabel('Price (USD)').fill('20.00');
    await first.getByRole('button', { name: 'Save changes' }).click();
    await expect(first).toHaveURL(/\/admin\/products$/);

    await second.getByLabel('Stock', { exact: true }).fill('9');
    await second.getByRole('button', { name: 'Save changes' }).click();
    const dialog = second.getByRole('dialog', { name: 'Someone else changed this product' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Reload latest' }).click();
    await expect(second.getByLabel('Price (USD)')).toHaveValue('20.00');
    await expect(second.getByLabel('Stock', { exact: true })).toHaveValue('9');
    await second.getByRole('button', { name: 'Save changes' }).click();
    await expect(second).toHaveURL(/\/admin\/products$/);

    const saved = await (await request.get(`/api/v1/products/${product.id}`)).json();
    expect(saved).toMatchObject({ price: { amountCents: 2000 }, stock: 9, version: 3 });
  });
});

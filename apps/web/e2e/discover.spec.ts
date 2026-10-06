import { expect, test } from '@playwright/test';
import { createProduct, failOnDialogs, uniqueSku } from './support';

test.describe('Discover', () => {
  test('turns a natural-language query into visible filters @mobile', async ({ page }) => {
    await page.goto('/shop');
    await page.getByLabel('Describe what you are looking for').fill('cheap electronics under $30 in stock');
    await expect(page).toHaveURL(/q=cheap/);
    for (const chip of ['Up to $30', 'In stock', 'Lowest price first', 'Electronics']) {
      await expect(page.getByRole('button', { name: `Remove ${chip}` })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Remove Electronics' }).click();
    await expect(page.getByLabel('Describe what you are looking for')).toHaveValue(
      'cheap under $30 in stock',
    );
  });

  test('finds products despite typos and keeps state in the URL', async ({ page }) => {
    await page.goto('/shop?q=bluetoth');
    await expect(page.getByRole('link', { name: 'Bluetooth Speaker' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Describe what you are looking for')).toHaveValue('bluetoth');
  });

  test('shows closest matches when no product matches every misspelled word', async ({ page, request }) => {
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    await createProduct(request, { sku: uniqueSku('ZRB'), name: `Zorblax Kettle ${suffix}` });
    await createProduct(request, { sku: uniqueSku('QNT'), name: `Quintoria Lantern ${suffix}` });
    await page.goto('/shop?q=zorblx%20quintora');
    await expect(page.getByRole('status').filter({ hasText: 'No product matches every word' })).toBeVisible();
    await expect(page.getByRole('link', { name: `Zorblax Kettle ${suffix}` }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: `Quintoria Lantern ${suffix}` }).first()).toBeVisible();
  });

  test('matches several misspelled words without a hint when one product has them all', async ({ page }) => {
    await page.goto('/shop?q=runing%20shoez');
    await expect(page.getByRole('link', { name: 'Running Shoes' }).first()).toBeVisible();
    await expect(page.getByText('No product matches every word')).toHaveCount(0);
  });

  test('renders hostile product names as plain text', async ({ page }) => {
    failOnDialogs(page);
    await page.goto('/shop?q=script');
    await expect(page.getByText("<script>alert('xss')</script>").first()).toBeVisible();
    await page.goto('/shop?q=DROP%20TABLE');
    await expect(page.getByText("Robert'); DROP TABLE products;--").first()).toBeVisible();
  });

  test('opens the command palette and jumps to a product', async ({ page }) => {
    await page.goto('/shop');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByPlaceholder('Search products or jump to…').fill('running shoes');
    await page
      .getByRole('option', { name: /Running Shoes/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/shop\/products\//);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Running Shoes');
  });
});

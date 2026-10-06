import { expect, test } from '@playwright/test';
import { uniqueSku } from './support';

test.describe('CSV import', () => {
  test('imports a file and shows the data-quality report', async ({ page }) => {
    const a = uniqueSku('CSV');
    const b = uniqueSku('CSV');
    const csv = [
      'name,sku,description,category,price,stock,weight_kg',
      `Imported Mug,${a},Ceramic,Kitchen,$12.00,10,0.4`,
      `Imported Tray,${b},"Bamboo, large",Kitchen,"1,299.00",2,`,
      `Broken Row,${uniqueSku('BAD')},x,Kitchen,free,-1,0.1`,
      ',,,,,,',
    ].join('\n');
    await page.goto('/admin/imports');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page).toHaveURL(/\/admin\/imports\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'e2e.csv' })).toBeVisible();
    await expect(page.getByText('67%')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'INVALID_PRICE' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'NEGATIVE_STOCK' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download issues CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/issues\.csv$/);
  });

  test('explains a file with a missing header', async ({ page }) => {
    await page.goto('/admin/imports');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('name,sku\nA,B-1\n') });
    await expect(page.getByText(/missing required columns/)).toBeVisible();
  });

  test('shows the seeded example import with 5 rejected rows', async ({ page }) => {
    await page.goto('/admin/imports');
    await page.getByRole('link', { name: /seeded on first start/ }).click();
    await expect(page.getByRole('heading', { name: 'Code Challenge E-Commerce.csv' })).toBeVisible();
    await page.getByRole('tab', { name: 'Errors' }).click();
    await expect(page.getByRole('cell', { name: 'YM-015' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'GC-025' })).toBeVisible();
  });
});

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

const DOCS = fileURLToPath(new URL('../../../docs/manual/', import.meta.url));
const OUT = join(DOCS, 'images');
const DATA = join(DOCS, 'test-data');
const JAEGER = process.env.JAEGER_URL ?? 'http://localhost:16686';

async function settle(page: Page, extra = 900): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(extra);
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, fullPage });
}

async function newPage(browser: Browser, theme: 'dark' | 'light' = 'dark', options = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript((value) => window.localStorage.setItem('stockroom.theme', value), theme);
  return context.newPage();
}

async function productBySku(request: APIRequestContext, sku: string): Promise<{ id: string; version: number }> {
  const response = await request.get(`/api/v1/products?q=${encodeURIComponent(sku)}`);
  const body = (await response.json()) as { data: { id: string; sku: string; version: number }[] };
  const match = body.data.find((product) => product.sku === sku);
  if (!match) throw new Error(`Product ${sku} not found`);
  return match;
}

async function checkout(page: Page, card: string): Promise<void> {
  await page.goto('/shop/checkout');
  await page.getByLabel('Full name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('button', { name: new RegExp(card.replace(/(\d{4})(?=\d)/g, '$1 ')) }).click();
}

test('capture manual screenshots', async ({ browser, request }) => {
  const page = await newPage(browser);

  await page.goto('/shop');
  await settle(page, 1500);
  await shot(page, '01-discover-home');

  await page.getByLabel('Describe what you are looking for').fill('cheap electronics under $30 in stock');
  await expect(page.getByRole('button', { name: 'Remove Electronics' })).toBeVisible();
  await settle(page, 1500);
  await shot(page, '02-smart-search');

  await page.goto('/shop?q=bluetoth');
  await settle(page, 1500);
  await shot(page, '03-typo-search');

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search products or jump to…').fill('speaker');
  await expect(page.getByRole('option', { name: /Speaker/ }).first()).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '04-command-palette');
  await page.keyboard.press('Escape');

  const shoes = await productBySku(request, 'RS-001');
  await page.goto(`/shop/products/${shoes.id}`);
  await settle(page);
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await shot(page, '05-product-detail');
  await page.getByRole('button', { name: 'Add to cart' }).click();

  const speaker = await productBySku(request, 'BS-021');
  await page.goto(`/shop/products/${speaker.id}`);
  await settle(page, 400);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/shop/cart');
  await settle(page);
  await shot(page, '06-cart');

  await checkout(page, '4242424242424242');
  await settle(page, 400);
  await shot(page, '07-checkout', true);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByRole('heading', { name: /Order confirmed/ })).toBeVisible();
  await settle(page, 1200);
  await shot(page, '08-order-confirmed');
  const confirmedOrderUrl = page.url();

  const clock = await productBySku(request, 'VC-001');
  await page.goto(`/shop/products/${clock.id}`);
  await settle(page);
  await shot(page, '09-out-of-stock');

  const lamp = await productBySku(request, 'DL-045');
  await page.goto(`/shop/products/${lamp.id}`);
  await settle(page, 400);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await checkout(page, '4000000000000002');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByRole('heading', { name: 'Order cancelled' })).toBeVisible();
  await settle(page, 1200);
  await shot(page, '10-order-declined');

  await page.goto('/admin/products');
  await settle(page);
  await shot(page, '11-studio-products');

  await page.goto('/admin/products/new');
  await settle(page, 400);
  await page.getByLabel('SKU').fill('man-100');
  await page.getByLabel('Category').fill('Home & Office');
  await page.getByLabel('Name', { exact: true }).fill('Walnut Monitor Riser');
  await page.getByLabel('Description').fill('Solid walnut, 60 cm wide, cable cut-out');
  await page.getByLabel('Price (USD)').fill('89.00');
  await page.getByLabel('Stock', { exact: true }).fill('25');
  await page.getByLabel('Weight (kg)').fill('2.4');
  await page.waitForTimeout(500);
  await shot(page, '12-product-form');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);

  const riser = await productBySku(request, 'MAN-100');
  const first = await newPage(browser);
  const second = await newPage(browser);
  await first.goto(`/admin/products/${riser.id}/edit`);
  await second.goto(`/admin/products/${riser.id}/edit`);
  await expect(second.getByLabel('Price (USD)')).toHaveValue('89.00');
  await first.getByLabel('Price (USD)').fill('79.00');
  await first.getByRole('button', { name: 'Save changes' }).click();
  await expect(first).toHaveURL(/\/admin\/products$/);
  await second.getByLabel('Stock', { exact: true }).fill('30');
  await second.getByRole('button', { name: 'Save changes' }).click();
  await expect(second.getByRole('dialog')).toBeVisible();
  await second.waitForTimeout(600);
  await shot(second, '13-version-conflict');
  await second.getByRole('button', { name: 'Reload latest' }).click();
  await second.getByRole('button', { name: 'Save changes' }).click();
  await expect(second).toHaveURL(/\/admin\/products$/);

  await page.goto('/admin/products');
  await page.getByLabel('Search products').fill('MAN-100');
  await settle(page, 600);
  await page.getByRole('row', { name: /MAN-100/ }).getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '14-delete-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/admin/imports');
  await settle(page);
  await shot(page, '15-imports');

  await page.locator('input[type=file]').setInputFiles(join(DATA, 'products-mixed-quality.csv'));
  await expect(page).toHaveURL(/\/admin\/imports\/[0-9a-f-]{36}$/);
  await settle(page, 1800);
  await shot(page, '16-import-report-mixed', true);

  await page.goto('/admin/imports');
  await settle(page, 400);
  await page.getByRole('link', { name: /seeded on first start/ }).click();
  await settle(page, 1800);
  await shot(page, '17-import-report-seed', true);

  await page.goto('/admin/imports');
  await page.locator('input[type=file]').setInputFiles(join(DATA, 'products-missing-header.csv'));
  await expect(page.getByText(/missing required columns/)).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '18-import-missing-header');

  await page.goto('/admin/orders');
  await settle(page);
  await shot(page, '19-studio-orders');

  await page.goto(confirmedOrderUrl.replace('/shop/orders/', '/admin/orders/'));
  await settle(page);
  await shot(page, '20-studio-order-detail');

  const light = await newPage(browser, 'light');
  await light.goto('/shop');
  await settle(light, 1500);
  await shot(light, '21-light-theme');

  const mobile = await newPage(browser, 'dark', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mobile.goto('/shop?q=sports%20under%20%2420');
  await settle(mobile, 1500);
  await shot(mobile, '22-mobile-shop');

  await page.goto('/api/docs');
  await expect(page.locator('.opblock-tag', { hasText: 'Orders' })).toBeVisible();
  await page.locator('.opblock-summary-path', { hasText: '/orders' }).first().click();
  await page.waitForTimeout(800);
  await shot(page, '23-api-docs');

  const jaeger = await request.get(`${JAEGER}/api/traces?service=gateway&lookback=1h&limit=100`).catch(() => null);
  if (jaeger?.ok()) {
    const traces = ((await jaeger.json()) as { data: { traceID: string; spans: { operationName: string }[] }[] }).data;
    const purchase = traces.find((trace) => trace.spans.some((span) => span.operationName.startsWith('payments.payment.succeeded')));
    if (purchase) {
      await page.goto(`${JAEGER}/trace/${purchase.traceID}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      await shot(page, '24-jaeger-trace');
    }
  }
});

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Locator, test } from '@playwright/test';
import { overlayScript } from './overlay';

const DOCS = fileURLToPath(new URL('../../../docs/manual/', import.meta.url));
const JAEGER = process.env.JAEGER_URL ?? 'http://localhost:16686';
const TOTAL = 23;

type Chapter = { id: string; title: string; seconds: number };

test('Claude live test of Stockroom', async ({ browser, request }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: 'live-results/video', size: { width: 1280, height: 800 } },
  });
  const started = Date.now();
  await context.addInitScript(() => window.localStorage.setItem('stockroom.theme', 'dark'));
  await context.addInitScript(overlayScript);
  const page = await context.newPage();
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`Unexpected dialog: ${dialog.message()}`);
  });
  const chapters: Chapter[] = [];
  let done = 0;

  const caption = async (id: string, title: string, detail: string, status: 'running' | 'pass') => {
    const payload = JSON.stringify({ id, title, detail, status, progress: `${Math.min(done, TOTAL)}/${TOTAL} passed` });
    await page.evaluate((value) => {
      sessionStorage.setItem('stockroom.live.caption', value);
      (window as unknown as { __srRender?: () => void }).__srRender?.();
    }, payload);
  };

  const step = async (id: string, title: string, detail: string, run: () => Promise<void>) => {
    chapters.push({ id, title, seconds: Math.round((Date.now() - started) / 1000) });
    await caption(id, title, detail, 'running');
    await page.waitForTimeout(900);
    await run();
    done++;
    await caption(id, title, detail, 'pass');
    await page.waitForTimeout(1400);
  };

  const type = async (locator: Locator, text: string) => {
    await locator.click();
    await locator.fill('');
    await locator.pressSequentially(text, { delay: 45 });
  };

  const productId = async (api: APIRequestContext, sku: string) => {
    const body = (await (await api.get(`/api/v1/products?q=${encodeURIComponent(sku)}`)).json()) as { data: { id: string; sku: string }[] };
    const found = body.data.find((product) => product.sku === sku);
    if (!found) throw new Error(`Missing ${sku}`);
    return found.id;
  };

  const settle = async (ms = 700) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(ms);
  };

  const checkout = async (card: string) => {
    await page.goto('/shop/checkout');
    await settle(300);
    await type(page.getByLabel('Full name'), 'Ada Lovelace');
    await type(page.getByLabel('Email'), 'ada@example.com');
    await page.getByRole('button', { name: new RegExp(card.replace(/(\d{4})(?=\d)/g, '$1 ')) }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Place order' }).click();
  };

  await page.goto('/shop');
  await settle(800);
  chapters.push({ id: 'INTRO', title: 'Fresh stack, seeded catalog', seconds: 0 });
  await caption('INTRO', 'Live test starting', 'Fresh docker compose stack · 87 seeded products · every step is asserted', 'running');
  await page.waitForTimeout(3500);

  await step('UC-S1', 'Browse the catalog', 'Filter by the Electronics category', async () => {
    await page.getByRole('button', { name: /^Electronics/ }).click();
    await expect(page.getByText('16', { exact: true }).first()).toBeVisible();
    await settle();
    await page.getByRole('button', { name: /^Electronics/ }).click();
  });

  await step('UC-S2', 'Search in your own words', '"cheap electronics under $30 in stock" becomes filters', async () => {
    await type(page.getByLabel('Describe what you are looking for'), 'cheap electronics under $30 in stock');
    for (const chip of ['Up to $30', 'In stock', 'Lowest price first', 'Electronics'])
      await expect(page.getByRole('button', { name: `Remove ${chip}` })).toBeVisible();
    await settle(1200);
  });

  await step('UC-S3', 'Typo-tolerant and hostile search', '"bluetoth" still finds speakers; "<script>" renders as text', async () => {
    await type(page.getByLabel('Describe what you are looking for'), 'bluetoth');
    await expect(page.getByRole('link', { name: 'Bluetooth Speaker' }).first()).toBeVisible();
    await settle(1000);
    await type(page.getByLabel('Describe what you are looking for'), 'script');
    await expect(page.getByText("<script>alert('xss')</script>").first()).toBeVisible();
    await settle(800);
  });

  await step('UC-S4', 'Command palette', '⌘K → "running shoes" → open product', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await type(page.getByPlaceholder('Search products or jump to…'), 'running shoes');
    await page.getByRole('option', { name: /Running Shoes/ }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Running Shoes');
    await settle();
  });

  await step('UC-S5', 'Build a cart', 'Running Shoes × 2 + Bluetooth Speaker → total $249.97', async () => {
    await page.goto(`/shop/products/${await productId(request, 'RS-001')}`);
    await settle(400);
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.goto(`/shop/products/${await productId(request, 'BS-021')}`);
    await settle(400);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: /Cart, 3 items/ }).click();
    await expect(page.getByText('$249.97').first()).toBeVisible();
    await settle();
  });

  await step('UC-S6', 'Checkout with an approved card', '4242 4242 4242 4242 → saga: reserve → pay → confirm', async () => {
    await checkout('4242424242424242');
    await expect(page.getByRole('heading', { name: /Order confirmed/ })).toBeVisible();
    await expect(page.getByText('Card •••• 4242')).toBeVisible();
    await settle(1200);
  });

  await step('UC-S7', 'Declined card', '4000 0000 0000 0002 → cancelled, stock released', async () => {
    await page.goto(`/shop/products/${await productId(request, 'DL-045')}`);
    await settle(400);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await checkout('4000000000000002');
    await expect(page.getByRole('heading', { name: 'Order cancelled' })).toBeVisible();
    await expect(page.getByText('The card was declined by the issuer.')).toBeVisible();
    await settle(1200);
  });

  await step('UC-S8', 'Out-of-stock product', 'Vintage Clock (stock 0) cannot be bought', async () => {
    await page.goto(`/shop/products/${await productId(request, 'VC-001')}`);
    await expect(page.getByRole('button', { name: 'Out of stock' })).toBeDisabled();
    await settle();
  });

  await step('UC-S9', 'Free order', 'Mystery Box $0.00 → confirmed without a payment', async () => {
    await page.goto('/shop/cart');
    await settle(300);
    for (const remove of await page.getByRole('button', { name: /^Remove / }).all()) await remove.click();
    await page.goto(`/shop/products/${await productId(request, 'MB-001')}`);
    await settle(400);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await checkout('4242424242424242');
    await expect(page.getByRole('heading', { name: /Order confirmed/ })).toBeVisible();
    await expect(page.getByText('Nothing to charge for a free order')).toBeVisible();
    await settle(1200);
  });

  await step('UC-A1', 'Studio · products', 'Admin table with stock, reservations and status', async () => {
    await page.getByRole('link', { name: 'Products' }).click();
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await settle(1000);
  });

  await step('UC-A3', 'Validation', 'Empty form → field errors', async () => {
    await page.getByRole('link', { name: 'New product' }).click();
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page.getByText('SKU is required')).toBeVisible();
    await expect(page.getByText('Enter a price like 19.99')).toBeVisible();
    await settle(800);
  });

  await step('UC-A2', 'Create a product', 'MAN-100 · Walnut Monitor Riser · $89.00 · live preview', async () => {
    await type(page.getByLabel('SKU'), 'man-100');
    await type(page.getByLabel('Category'), 'Home & Office');
    await type(page.getByLabel('Name', { exact: true }), 'Walnut Monitor Riser');
    await type(page.getByLabel('Description'), 'Solid walnut, 60 cm wide, cable cut-out');
    await type(page.getByLabel('Price (USD)'), '89.00');
    await type(page.getByLabel('Stock', { exact: true }), '25');
    await type(page.getByLabel('Weight (kg)'), '2.4');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await type(page.getByLabel('Search products'), 'MAN-100');
    await expect(page.getByRole('row', { name: /MAN-100/ })).toContainText('$89.00');
  });

  await step('UC-A5', 'Concurrent edit is detected', 'Another admin saves first (API) → conflict → reload keeps my edit', async () => {
    const id = await productId(request, 'MAN-100');
    await page.goto(`/admin/products/${id}/edit`);
    await settle(400);
    const other = await request.put(`/api/v1/products/${id}`, {
      headers: { 'if-match': '"1"' },
      data: { name: 'Walnut Monitor Riser', category: 'Home & Office', priceCents: 7900, stock: 25, weightGrams: 2400, description: 'Solid walnut, 60 cm wide, cable cut-out' },
    });
    expect(other.status()).toBe(200);
    await type(page.getByLabel('Stock', { exact: true }), '30');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog', { name: 'Someone else changed this product' })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Reload latest' }).click();
    await expect(page.getByLabel('Price (USD)')).toHaveValue('79.00');
    await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('30');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    const saved = (await (await request.get(`/api/v1/products/${id}`)).json()) as { stock: number; price: { amountCents: number } };
    expect(saved).toMatchObject({ stock: 30, price: { amountCents: 7900 } });
  });

  await step('UC-A6', 'Delete a product', 'Soft delete with confirmation', async () => {
    await type(page.getByLabel('Search products'), 'MAN-100');
    await page.getByRole('row', { name: /MAN-100/ }).getByRole('button', { name: /Delete/ }).click();
    await page.waitForTimeout(700);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('No products match')).toBeVisible();
  });

  await step('UC-A8', 'Import a CSV with problems', 'products-mixed-quality.csv → 4 created · 5 rejected · 1 warning', async () => {
    await page.getByRole('link', { name: 'Imports' }).click();
    await settle(500);
    await page.locator('input[type=file]').setInputFiles(join(DOCS, 'test-data', 'products-mixed-quality.csv'));
    await expect(page).toHaveURL(/\/admin\/imports\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('cell', { name: 'INVALID_PRICE' })).toBeVisible();
    await expect(page.getByText('50%')).toBeVisible();
    await settle(1500);
    await page.getByRole('tab', { name: 'Warnings' }).click();
    await expect(page.getByRole('cell', { name: 'DUPLICATE_SKU_IN_FILE' })).toBeVisible();
    await settle(800);
  });

  await step('UC-A9', 'Reject a CSV with missing columns', 'products-missing-header.csv → nothing imported', async () => {
    await page.goto('/admin/imports');
    await settle(400);
    await page.locator('input[type=file]').setInputFiles(join(DOCS, 'test-data', 'products-missing-header.csv'));
    await expect(page.getByText(/missing required columns/)).toBeVisible();
    await page.waitForTimeout(1500);
  });

  await step('UC-A11', 'The challenge CSV, seeded on first start', '97 lines · 87 created · 5 rejected · 3 warnings', async () => {
    await page.getByRole('link', { name: /seeded on first start/ }).click();
    await expect(page.getByRole('heading', { name: 'Code Challenge E-Commerce.csv' })).toBeVisible();
    await page.getByRole('tab', { name: 'Errors' }).click();
    await expect(page.getByRole('cell', { name: 'YM-015' })).toBeVisible();
    await settle(1500);
  });

  await step('UC-A12', 'Follow orders in the Studio', 'Statuses, totals and saga history', async () => {
    await page.getByRole('link', { name: 'Orders' }).click();
    await expect(page.getByRole('cell', { name: 'Confirmed' }).first()).toBeVisible();
    await settle(800);
    await page.getByRole('link', { name: /…$/ }).last().click();
    await expect(page.getByText('Order received')).toBeVisible();
    await settle(1200);
  });

  await step('UC-P1a', 'Light theme', 'Theme toggle, remembered on this device', async () => {
    await page.goto('/shop');
    await settle(500);
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  });

  await step('UC-P1b', 'Mobile layout', 'Phone-sized viewport · navigation collapses to icons', async () => {
    await page.setViewportSize({ width: 412, height: 800 });
    await type(page.getByLabel('Describe what you are looking for'), 'sports under $20');
    await expect(page.getByRole('button', { name: 'Remove Sports' })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await step('UC-P2', 'API documentation', 'OpenAPI 3.1 generated from the shared schemas · Swagger UI', async () => {
    await page.goto('/api/docs');
    await expect(page.locator('.opblock-tag', { hasText: 'Orders' })).toBeVisible();
    await page.locator('.opblock-summary-path', { hasText: '/orders' }).first().click();
    await page.waitForTimeout(1500);
  });

  await step('UC-P3', 'One purchase = one distributed trace', 'Jaeger: gateway → orders → catalog → payments via RabbitMQ', async () => {
    const response = await request.get(`${JAEGER}/api/traces?service=gateway&lookback=1h&limit=100`);
    expect(response.ok()).toBe(true);
    const traces = ((await response.json()) as { data: { traceID: string; spans: { operationName: string }[]; processes: Record<string, { serviceName: string }> }[] }).data;
    const purchase = traces.find((trace) => trace.spans.some((span) => span.operationName.startsWith('payments.payment.succeeded')));
    expect(purchase).toBeDefined();
    expect(new Set(Object.values(purchase?.processes ?? {}).map((process) => process.serviceName))).toEqual(new Set(['gateway', 'orders', 'catalog', 'payments']));
    await page.goto(`${JAEGER}/trace/${purchase?.traceID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
  });

  await step('UC-P4', 'Idempotent order placement', 'Same Idempotency-Key sent twice → one order, second call is a replay', async () => {
    const method = await request.post('/api/v1/payments/methods', { data: { cardNumber: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', holderName: 'Replay' } });
    const pm = (await method.json()) as { id: string };
    const key = crypto.randomUUID();
    const body = { customer: { name: 'Replay', email: 'replay@example.com' }, lines: [{ productId: await productId(request, 'RS-050'), quantity: 1 }], paymentMethodId: pm.id };
    const first = (await (await request.post('/api/v1/orders', { data: body, headers: { 'idempotency-key': key } })).json()) as { id: string };
    const second = await request.post('/api/v1/orders', { data: body, headers: { 'idempotency-key': key } });
    expect(second.headers()['idempotent-replayed']).toBe('true');
    expect(((await second.json()) as { id: string }).id).toBe(first.id);
    await page.goto(`/admin/orders/${first.id}`);
    await settle(1500);
  });

  chapters.push({ id: 'END', title: `All ${TOTAL} checks passed`, seconds: Math.round((Date.now() - started) / 1000) });
  await page.goto('/shop');
  await settle(500);
  await caption('DONE', `All ${done}/${TOTAL} checks passed`, `Recorded live in ${Math.round((Date.now() - started) / 1000)} s against the running Docker stack`, 'pass');
  await page.waitForTimeout(4000);

  expect(done).toBe(TOTAL);
  writeFileSync(join(DOCS, 'videos', 'live-test-chapters.json'), JSON.stringify(chapters, null, 2) + '\n');
  await context.close();
});

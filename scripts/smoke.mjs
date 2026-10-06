const base = process.env.BASE_URL ?? 'http://localhost:8080/api';
const results = [];

async function call(method, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, json };
}

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTerminal(id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { json } = await call('GET', `/v1/orders/${id}`);
    if (json.status === 'CONFIRMED' || json.status === 'CANCELLED') return json;
    await sleep(500);
  }
  return (await call('GET', `/v1/orders/${id}`)).json;
}

async function purchase(product, card, quantity = 1) {
  const method = await call('POST', '/v1/payments/methods', {
    cardNumber: card,
    expMonth: 12,
    expYear: 2030,
    cvc: '123',
    holderName: 'Smoke Test',
  });
  const order = await call(
    'POST',
    '/v1/orders',
    {
      customer: { name: 'Smoke Test', email: 'smoke@example.com' },
      lines: [{ productId: product.id, quantity }],
      paymentMethodId: method.json.id,
    },
    { 'idempotency-key': crypto.randomUUID() },
  );
  return { method, order, final: order.status === 202 ? await waitForTerminal(order.json.id) : null };
}

const list = await call('GET', '/v1/products?pageSize=100');
check('lists the seeded catalog (at least 87 products)', list.status === 200 && list.json.page.totalItems >= 87, list.json.page);

const search = await call('GET', '/v1/products?q=bluetoth');
check('typo-tolerant search finds speakers', search.json.data?.some((item) => item.sku.startsWith('BS-')), search.json);

const categories = await call('GET', '/v1/categories');
check('lists the seeded categories (at least 17)', categories.json.data?.length >= 17, categories.json);

const invalid = await call('POST', '/v1/products', { sku: '', name: ' ', category: '', priceCents: -1, stock: 1.5 });
check(
  'rejects invalid products with problem+json field errors',
  invalid.status === 400 && invalid.headers.get('content-type')?.includes('problem+json') && invalid.json.errors?.length >= 4,
  invalid.json,
);

const malformed = await call('POST', '/v1/products', '{bad');
check('rejects malformed JSON with a problem body', malformed.status === 400 && malformed.json.code, malformed.json);

const sku = `SMOKE-${Date.now()}`;
const created = await call('POST', '/v1/products', {
  sku,
  name: 'Smoke Lamp',
  description: 'Created by the smoke test',
  category: 'Home & Office',
  priceCents: 1999,
  stock: 1,
  weightGrams: 500,
});
check('creates a product with Location and ETag', created.status === 201 && created.headers.get('location')?.startsWith('/api/v1/products/') && created.headers.get('etag') === '"1"', created.json);

const duplicate = await call('POST', '/v1/products', { sku, name: 'Dup', category: 'Misc', priceCents: 1, stock: 1 });
check('rejects duplicate SKU with 409', duplicate.status === 409 && duplicate.json.code === 'DUPLICATE_SKU', duplicate.json);

const noIfMatch = await call('PUT', `/v1/products/${created.json.id}`, { name: 'x', category: 'Misc', priceCents: 1, stock: 1 });
check('requires If-Match on update (428)', noIfMatch.status === 428, noIfMatch.json);

const stale = await call('PUT', `/v1/products/${created.json.id}`, { name: 'x', category: 'Misc', priceCents: 1, stock: 1 }, { 'if-match': '"9"' });
check('detects stale versions (409)', stale.status === 409 && stale.json.code === 'VERSION_CONFLICT', stale.json);

const declined = await purchase(created.json, '4000000000000002');
check('declined card cancels the order', declined.final?.status === 'CANCELLED' && declined.final?.cancellation?.reason === 'PAYMENT_DECLINED', declined.final ?? declined.order.json);

const afterDecline = await call('GET', `/v1/products/${created.json.id}`);
check('declined order releases the reservation', afterDecline.json.reserved === 0 && afterDecline.json.stock === 1, afterDecline.json);

const approved = await purchase(created.json, '4242 4242 4242 4242');
check('approved card confirms the order', approved.final?.status === 'CONFIRMED' && approved.final?.payment?.last4 === '4242', approved.final ?? approved.order.json);

const afterConfirm = await call('GET', `/v1/products/${created.json.id}`);
check('confirmed order decrements stock', afterConfirm.json.stock === 0 && afterConfirm.json.reserved === 0, afterConfirm.json);

const soldOut = await purchase(created.json, '4242424242424242');
check('sold-out product is rejected up front', soldOut.order.status === 409 && soldOut.order.json.code === 'INSUFFICIENT_STOCK', soldOut.order.json);

const flaky = (list.json.data ?? []).find((item) => item.available > 5);
const retried = await purchase(flaky, '4000000000000119');
check('transient payment error is retried and succeeds', retried.final?.status === 'CONFIRMED', retried.final ?? retried.order.json);

const key = crypto.randomUUID();
const tokenized = await call('POST', '/v1/payments/methods', { cardNumber: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', holderName: 'Idem' });
const body = { customer: { name: 'Idem', email: 'idem@example.com' }, lines: [{ productId: flaky.id, quantity: 1 }], paymentMethodId: tokenized.json.id };
const first = await call('POST', '/v1/orders', body, { 'idempotency-key': key });
const second = await call('POST', '/v1/orders', body, { 'idempotency-key': key });
check('idempotent order replay returns the same order', first.json.id === second.json.id && second.headers.get('idempotent-replayed') === 'true', second.json);

const deleted = await call('DELETE', `/v1/products/${created.json.id}`);
check('deletes the product (204)', deleted.status === 204, deleted.json);

const imports = await call('GET', '/v1/imports');
check('seed import is visible in history', imports.json.data?.some((job) => job.source === 'SEED' && job.totals.created === 87), imports.json);

const internal = await call('GET', '/internal/v1/products/snapshot?ids=x');
check('internal endpoints are not exposed by the gateway', internal.status === 404, internal.json);

const failed = results.filter((result) => !result.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);

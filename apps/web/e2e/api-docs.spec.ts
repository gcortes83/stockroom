import { expect, test } from '@playwright/test';

test('serves interactive API docs through nginx without CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused/.test(message.text())) violations.push(message.text());
  });
  await page.goto('/api/docs');
  await expect(page.getByRole('heading', { name: /Stockroom API/ })).toBeVisible();
  await expect(page.locator('.opblock-tag', { hasText: 'Orders' })).toBeVisible();
  await expect(page.locator('.opblock-summary-path', { hasText: '/orders' }).first()).toBeVisible();
  expect(violations).toEqual([]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PATHS = [
  '/shop',
  '/shop/cart',
  '/shop/checkout',
  '/admin/products',
  '/admin/imports',
  '/admin/orders',
  '/admin/products/new',
];

for (const theme of ['dark', 'light'] as const)
  for (const path of PATHS) {
    test(`has no critical or serious accessibility violations on ${path} (${theme})`, async ({ page }) => {
      await page.addInitScript((value) => window.localStorage.setItem('stockroom.theme', value), theme);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );
      expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.length} nodes`)).toEqual([]);
    });
  }

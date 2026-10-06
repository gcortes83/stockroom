import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './live',
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 25_000 },
  reporter: [['list']],
  outputDir: './live-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: { slowMo: 120 },
  },
});

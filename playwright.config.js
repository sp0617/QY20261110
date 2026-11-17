import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
  },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:3100/api/health',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    env: { PORT: '3100', HOST: '127.0.0.1' },
  },
});

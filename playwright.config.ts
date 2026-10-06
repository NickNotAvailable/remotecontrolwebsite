import { defineConfig } from '@playwright/test';

// See test/e2e/helpers.ts → envWithoutProxy(): keep browsers off any sandbox proxy.
const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/proxy/i.test(k))) as Record<string, string>;

const PORT = Number(process.env.E2E_PORT || 4317);

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      // software WebGL in headless CI
      args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      env: browserEnv,
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node server/index.js',
    url: `http://localhost:${PORT}/healthz`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

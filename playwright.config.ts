import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm --filter @crdt-canvas/client run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    cwd: '/home/kevin/Projects/cool/crdt-canvas/apps/client',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
        },
      },
    },
  ],
});

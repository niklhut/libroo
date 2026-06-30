import { defineConfig, devices } from '@playwright/test'
import { e2eEmailRuntimeEnv, e2eRuntimeEnv } from './test/e2e/support/runtime'

const appPort = Number(e2eRuntimeEnv.NUXT_PORT)
const fixturePort = Number(e2eRuntimeEnv.LIBROO_OPENLIBRARY_FIXTURE_PORT)
const emailAppPort = Number(e2eEmailRuntimeEnv.NUXT_PORT)
const mailSinkHttpPort = Number(e2eEmailRuntimeEnv.LIBROO_MAIL_SINK_HTTP_PORT)
const baseURL = `http://127.0.0.1:${appPort}`
const emailBaseURL = `http://127.0.0.1:${emailAppPort}`

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  globalSetup: './test/e2e/support/globalSetup.ts',
  globalTeardown: './test/e2e/support/globalTeardown.ts',
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }]
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-chromium',
      grepInvert: /@mobile|@email/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium'
      }
    },
    {
      name: 'mobile-pixel-5',
      grep: /@mobile/,
      use: {
        ...devices['Pixel 5']
      }
    },
    {
      name: 'email-desktop-chromium',
      grep: /@email/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: emailBaseURL,
        channel: 'chromium'
      }
    }
  ],
  webServer: [
    {
      command: 'node test/e2e/support/openlibrary-fixture-server.mjs',
      url: `http://127.0.0.1:${fixturePort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: e2eRuntimeEnv
    },
    {
      command: 'node test/e2e/support/mail-sink-server.mjs',
      url: `http://127.0.0.1:${mailSinkHttpPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: e2eEmailRuntimeEnv
    },
    {
      command: 'node test/e2e/support/bootstrap-runtime.mjs && node .output/server/index.mjs',
      url: `${baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: e2eRuntimeEnv
    },
    {
      command: 'node test/e2e/support/bootstrap-runtime.mjs && node .output/server/index.mjs',
      url: `${emailBaseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: e2eEmailRuntimeEnv
    }
  ]
})

import { fileURLToPath } from 'node:url'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const appDir = fileURLToPath(new URL('./app/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '~': appDir,
      '~~': rootDir,
      '@': appDir,
      '@@': rootDir,
      'hub:db:schema': fileURLToPath(new URL('./server/db/schema/index.ts', import.meta.url))
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts']
        }
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: '2026-06-26',
              compatibilityFlags: ['nodejs_compat'],
              d1Databases: {
                DB: 'libroo-d1-test'
              }
            }
          })
        ],
        test: {
          name: 'd1',
          include: ['test/d1/**/*.test.ts']
        }
      }
    ]
  }
})

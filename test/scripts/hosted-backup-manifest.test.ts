import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runScript, scriptPath } from './helpers'

describe('hosted backup manifest CLI', () => {
  it('emits a Cloudflare D1/R2 manifest without inspecting remote migration state', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'libroo-hosted-manifest-test-'))
    try {
      const outputPath = join(tempDir, 'manifest.json')
      const result = runScript(scriptPath('scripts/hosted-backup-manifest.mjs'), ['--output', outputPath], {
        env: {
          NUXT_LIBROO_RUNTIME_PROFILE: 'cloudflare',
          NUXT_CLOUDFLARE_WORKER_NAME: 'libroo-production',
          NUXT_HUB_CLOUDFLARE_DATABASE_ID: 'prod-db-uuid-456',
          NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-production-bucket'
        }
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Hosted backup manifest written:')

      const manifest = JSON.parse(await readFile(outputPath, 'utf8'))
      expect(manifest).toMatchObject({
        runtime: {
          profile: 'cloudflare',
          database: 'cloudflare-d1',
          blobStorage: 'cloudflare-r2',
          worker: 'libroo-production',
          d1Database: 'prod-db-uuid-456',
          r2Bucket: 'libroo-production-bucket'
        },
        migrations: {
          appliedState: {
            status: 'unavailable',
            source: 'cloudflare-d1'
          }
        }
      })
      expect(manifest.app.version).toMatch(/^\d+\.\d+\.\d+/)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

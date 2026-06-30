import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fixturesDir,
  readJsonFile,
  runScript,
  scriptPath,
  writeJsonFile
} from './helpers'

const previewEnv = {
  NUXT_CLOUDFLARE_WORKER_NAME: 'libroo-pr-42',
  NUXT_CLOUDFLARE_ACCESS_AUDIENCE: 'preview-audience',
  NUXT_CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
  NUXT_CLOUDFLARE_CUSTOM_DOMAIN: '',
  NUXT_HUB_CLOUDFLARE_DATABASE_ID: 'preview-db-uuid-123',
  NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-preview-pr-42',
  PREVIEW_D1_DATABASE_NAME: 'libroo-preview-pr-42'
}

const productionEnv = {
  NUXT_HUB_CLOUDFLARE_DATABASE_ID: 'prod-db-uuid-456',
  NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-production-bucket',
  NUXT_CLOUDFLARE_CUSTOM_DOMAIN: 'https://library.example.test'
}

type WranglerConfigFixture = {
  d1_databases: Array<{
    database_id: string
  }>
  r2_buckets: Array<{
    bucket_name: string
  }>
}

describe('preview Wrangler config validator', () => {
  it('accepts an isolated preview fixture', () => {
    const result = runScript(scriptPath('scripts/preview/validate-wrangler-config.mjs'), [
      join(fixturesDir, 'wrangler-preview-valid.json'),
      join(fixturesDir, 'd1-inventory.json')
    ], { env: previewEnv })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Preview Wrangler configuration is isolated and safe')
  })

  it.each([
    {
      name: 'bad worker, D1, and R2 names',
      env: {
        ...previewEnv,
        NUXT_CLOUDFLARE_WORKER_NAME: 'libroo-production',
        PREVIEW_D1_DATABASE_NAME: 'libroo-production',
        NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-production-bucket'
      },
      message: 'not a preview name'
    },
    {
      name: 'mismatched PR suffix',
      env: {
        ...previewEnv,
        NUXT_HUB_CLOUDFLARE_BUCKET_NAME: 'libroo-preview-pr-43'
      },
      message: 'do not use the same PR suffix'
    },
    {
      name: 'custom domain set',
      env: {
        ...previewEnv,
        NUXT_CLOUDFLARE_CUSTOM_DOMAIN: 'preview.example.test'
      },
      message: 'NUXT_CLOUDFLARE_CUSTOM_DOMAIN must be unset'
    }
  ])('rejects preview config with $name', ({ env, message }) => {
    const result = runScript(scriptPath('scripts/preview/validate-wrangler-config.mjs'), [
      join(fixturesDir, 'wrangler-preview-valid.json'),
      join(fixturesDir, 'd1-inventory.json')
    ], { env })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('rejects missing preview var and incorrect bindings', () => {
    const result = runScript(scriptPath('scripts/preview/validate-wrangler-config.mjs'), [
      join(fixturesDir, 'wrangler-preview-invalid.json'),
      join(fixturesDir, 'd1-inventory.json')
    ], { env: previewEnv })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Preview runtime enforcement is not enabled')
    expect(result.stderr).toContain('Preview config must contain exactly one D1 binding named DB')
    expect(result.stderr).toContain('Preview config must contain exactly one R2 binding named BLOB')
  })
})

describe('production Wrangler config validator', () => {
  it('accepts a production fixture', () => {
    const result = runScript(scriptPath('scripts/production/validate-wrangler-config.mjs'), [
      join(fixturesDir, 'wrangler-production-valid.json')
    ], { env: productionEnv })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Production Wrangler configuration is safe')
  })

  it('rejects preview-pattern names, missing route, missing crons, workers_dev, preview runtime, and mismatched bindings', () => {
    const result = runScript(scriptPath('scripts/production/validate-wrangler-config.mjs'), [
      join(fixturesDir, 'wrangler-production-contaminated.json')
    ], { env: productionEnv })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Worker name matches a preview pattern')
    expect(result.stderr).toContain('Production routes must contain library.example.test with custom_domain enabled')
    expect(result.stderr).toContain('Production cron triggers must contain 0 3 * * *')
    expect(result.stderr).toContain('Production Worker must have workers_dev disabled or omitted')
    expect(result.stderr).toContain('Production runtime preview enforcement must be absent or "false"')
    expect(result.stderr).toContain('DB binding targets wrong-db-id, expected prod-db-uuid-456')
    expect(result.stderr).toContain('R2 name matches a preview pattern')
  })

  it('rejects a production fixture with the wrong binding IDs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'libroo-production-validator-test-'))
    try {
      const config = await readJsonFile<WranglerConfigFixture>(join(fixturesDir, 'wrangler-production-valid.json'))
      config.d1_databases[0].database_id = 'other-db'
      config.r2_buckets[0].bucket_name = 'other-bucket'
      const configPath = join(tempDir, 'wrangler.json')
      await writeJsonFile(configPath, config)

      const result = runScript(scriptPath('scripts/production/validate-wrangler-config.mjs'), [configPath], {
        env: productionEnv
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('DB binding targets other-db, expected prod-db-uuid-456')
      expect(result.stderr).toContain('BLOB binding targets other-bucket, expected libroo-production-bucket')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

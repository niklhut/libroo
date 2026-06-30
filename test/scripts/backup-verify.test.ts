import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkManifestCompatibility,
  formatVerificationReport,
  verifyBackupTarget
} from '../../scripts/lib/backup-verify.mjs'
import {
  buildTemporaryBackupTarget,
  fixturesDir,
  readJsonFile
} from './helpers'

type ManifestFixture = {
  app: {
    version: string
  }
  runtime: {
    profile: string
  }
  migrations: {
    latest: {
      tag: string
      idx: number
    }
  }
}

describe('backup verification helpers', () => {
  it('checks every documented manifest compatibility rule', async () => {
    const manifest = await readJsonFile<ManifestFixture>(join(fixturesDir, 'manifest-valid.json'))
    const current = {
      currentLatestMigration: { tag: '0004_fixture_latest', idx: 4 },
      currentVersion: '1.2.3',
      currentRuntimeProfile: 'selfhost'
    }

    expect(checkManifestCompatibility({
      ...manifest,
      runtime: { ...manifest.runtime, profile: 'cloudflare' }
    }, current).errors).toContain('Backup runtime profile cloudflare does not match current runtime profile selfhost.')

    expect(checkManifestCompatibility({
      ...manifest,
      migrations: { ...manifest.migrations, latest: { tag: '0005_future', idx: 5 } }
    }, current).errors[0]).toContain('Forward-only restore is not supported')

    expect(checkManifestCompatibility({
      ...manifest,
      migrations: { ...manifest.migrations, latest: { tag: '0003_previous', idx: 3 } }
    }, current).warnings[0]).toContain('restore will apply pending migrations')

    expect(checkManifestCompatibility({
      ...manifest,
      app: { version: '2.0.0' }
    }, current).errors[0]).toContain('Forward-only restore is not supported')

    expect(checkManifestCompatibility({
      ...manifest,
      app: { version: '1.0.0' }
    }, current).warnings[0]).toContain('verify release notes before restoring')

    expect(checkManifestCompatibility(manifest, current)).toEqual({
      errors: [],
      warnings: []
    })
  })

  it('formats verification reports for pass and failure results', () => {
    expect(formatVerificationReport({
      ok: true,
      errors: [],
      warnings: [],
      rowCounts: { books: 2, loans: 1 },
      coverReferences: {
        checked: [{ id: 'book-1' }],
        broken: [],
        orphanedBlobs: []
      }
    })).toContain('Backup verification passed.\nCore row counts: books=2, loans=1\nCover references checked: 1')

    const failed = formatVerificationReport({
      ok: false,
      errors: ['Database health probe failed: bad db'],
      warnings: ['Found 1 orphaned blob(s).'],
      rowCounts: { books: 2 },
      coverReferences: {
        checked: [{ id: 'book-1' }],
        broken: [{
          source: 'books',
          column: 'cover_path',
          id: 'book-2',
          path: 'covers/missing.webp'
        }],
        orphanedBlobs: ['covers/orphaned.webp']
      }
    })

    expect(failed).toContain('Backup verification failed.')
    expect(failed).toContain('Broken cover references:')
    expect(failed).toContain('- books.cover_path row book-2: covers/missing.webp')
    expect(failed).toContain('Orphaned blobs not referenced by books.cover_path or loans.snapshot_cover_path: 1')
    expect(failed).toContain('Warning: Found 1 orphaned blob(s).')
    expect(failed).toContain('Error: Database health probe failed: bad db')
  })

  it('verifies a backup target and reports row counts plus cover integrity issues', async () => {
    const target = await buildTemporaryBackupTarget()
    const manifest = await readJsonFile(join(fixturesDir, 'manifest-valid.json'))
    try {
      const result = await verifyBackupTarget({
        databaseUrl: target.databaseUrl,
        blobDir: target.blobDir,
        manifest,
        packageJsonPath: join(fixturesDir, 'package.json'),
        migrationJournalPath: join(fixturesDir, '_journal.json'),
        currentRuntimeProfile: 'selfhost'
      })

      expect(result.ok).toBe(false)
      expect(result.rowCounts).toMatchObject({
        user: 1,
        books: 2,
        loans: 1
      })
      expect(result.coverReferences.broken).toEqual([
        expect.objectContaining({
          source: 'books',
          column: 'cover_path',
          id: 'book-2',
          path: 'covers/manual/user-1/missing.webp'
        })
      ])
      expect(result.coverReferences.orphanedBlobs).toContain('covers/orphaned.webp')
      expect(result.errors).toContain('Missing 1 referenced cover blob(s).')
      expect(result.warnings).toContain('Found 1 orphaned blob(s).')
    } finally {
      await target.cleanup()
    }
  })

  it('returns a failed verification result for missing and malformed manifests', async () => {
    const target = await buildTemporaryBackupTarget({ integrityIssues: false })
    try {
      const missing = await verifyBackupTarget({
        databaseUrl: target.databaseUrl,
        blobDir: target.blobDir,
        manifestPath: join(target.rootDir, 'missing-manifest.json'),
        packageJsonPath: join(fixturesDir, 'package.json'),
        migrationJournalPath: join(fixturesDir, '_journal.json')
      })
      expect(missing.ok).toBe(false)
      expect(missing.errors[0]).toContain('Manifest verification failed:')

      const malformed = await verifyBackupTarget({
        databaseUrl: target.databaseUrl,
        blobDir: target.blobDir,
        manifest: { manifestFormatVersion: 1 },
        packageJsonPath: join(fixturesDir, 'package.json'),
        migrationJournalPath: join(fixturesDir, '_journal.json')
      })
      expect(malformed.ok).toBe(false)
      expect(malformed.errors[0]).toContain('Backup manifest is missing required field')
    } finally {
      await target.cleanup()
    }
  })
})

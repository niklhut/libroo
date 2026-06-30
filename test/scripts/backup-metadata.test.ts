import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MANIFEST_FILENAME,
  MANIFEST_FORMAT_VERSION,
  assertManifestShape,
  buildBackupManifest,
  createEmptyManifestShape,
  readAppliedMigrations,
  readLatestMigration,
  readPackageVersion
} from '../../scripts/lib/backup-metadata.mjs'
import {
  buildTemporaryBackupTarget,
  fixturesDir,
  readJsonFile
} from './helpers'

describe('backup metadata helpers', () => {
  it('creates the documented empty manifest skeleton', () => {
    expect(createEmptyManifestShape()).toEqual({
      manifestFormatVersion: 1,
      app: {
        version: ''
      },
      runtime: {
        profile: '',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      timestamps: {
        createdAt: '',
        databaseSnapshotAt: '',
        completedAt: ''
      },
      migrations: {
        latest: {
          tag: null,
          idx: null
        },
        applied: [],
        appliedState: {
          status: 'inspected',
          source: '__drizzle_migrations',
          reason: null
        }
      }
    })
  })

  it('exports the manifest constants used by backup artifacts', () => {
    expect(MANIFEST_FORMAT_VERSION).toBe(1)
    expect(MANIFEST_FILENAME).toBe('manifest.json')
  })

  it('reads package version and latest migration from explicit fixture paths', async () => {
    await expect(readPackageVersion(join(fixturesDir, 'package.json'))).resolves.toBe('1.2.3')
    await expect(readLatestMigration(join(fixturesDir, '_journal.json'))).resolves.toEqual({
      tag: '0004_fixture_latest',
      idx: 4
    })
  })

  it('reads applied migrations from a migrated temp database', async () => {
    const target = await buildTemporaryBackupTarget({ seedData: false })
    try {
      const migrations = await readAppliedMigrations(target.client)
      expect(migrations.length).toBeGreaterThan(0)
      expect(migrations.at(-1)).toMatchObject({
        hash: expect.any(String),
        createdAt: expect.any(Number)
      })
      expect(migrations.at(-1)?.id === null || typeof migrations.at(-1)?.id === 'number').toBe(true)
    } finally {
      await target.cleanup()
    }
  })

  it('returns an empty applied migration list when the migration table is absent', async () => {
    const target = await buildTemporaryBackupTarget({ applyMigrations: false, seedData: false })
    try {
      await expect(readAppliedMigrations(target.client)).resolves.toEqual([])
    } finally {
      await target.cleanup()
    }
  })

  it('builds a manifest with runtime, descriptor, timestamp, and migration metadata', async () => {
    const target = await buildTemporaryBackupTarget({ seedData: false })
    try {
      const manifest = await buildBackupManifest({
        client: target.client,
        runtimeProfile: 'selfhost',
        createdAt: new Date('2026-06-30T10:00:00.000Z'),
        databaseSnapshotAt: new Date('2026-06-30T10:01:00.000Z'),
        completedAt: new Date('2026-06-30T10:02:00.000Z'),
        packageJsonPath: join(fixturesDir, 'package.json'),
        migrationJournalPath: join(fixturesDir, '_journal.json'),
        extraRuntime: {
          databaseUrlKind: 'file',
          blobStorage: 'local'
        }
      })

      expect(manifest).toMatchObject({
        manifestFormatVersion: 1,
        app: {
          version: '1.2.3'
        },
        runtime: {
          profile: 'selfhost',
          databaseUrlKind: 'file',
          blobStorage: 'local'
        },
        timestamps: {
          createdAt: '2026-06-30T10:00:00.000Z',
          databaseSnapshotAt: '2026-06-30T10:01:00.000Z',
          completedAt: '2026-06-30T10:02:00.000Z'
        },
        migrations: {
          latest: {
            tag: '0004_fixture_latest',
            idx: 4
          },
          appliedState: {
            status: 'inspected',
            source: '__drizzle_migrations',
            reason: null
          }
        }
      })
      expect(manifest.migrations.applied.length).toBeGreaterThan(0)
    } finally {
      await target.cleanup()
    }
  })

  it('accepts a valid manifest fixture and rejects malformed fixtures', async () => {
    const validManifest = await readJsonFile(join(fixturesDir, 'manifest-valid.json'))
    expect(() => assertManifestShape(validManifest)).not.toThrow()

    const malformedFixtures = [
      'manifest-missing-fields.json',
      'manifest-bad-format-version.json',
      'manifest-bad-applied-format.json'
    ]

    for (const fixture of malformedFixtures) {
      const manifest = await readJsonFile(join(fixturesDir, fixture))
      expect(() => assertManifestShape(manifest), fixture).toThrow()
    }
  })
})

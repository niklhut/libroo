import { execFileSync } from 'node:child_process'
import { createClient } from '@libsql/client/node'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readLatestMigration,
  readPackageVersion
} from '../../scripts/lib/backup-metadata.mjs'
import {
  buildTemporaryBackupTarget,
  copyFixture,
  fileExists,
  fixturesDir,
  readJsonFile,
  repoRoot,
  runScript,
  scriptPath,
  writeJsonFile
} from './helpers'

type ManifestFixture = {
  app: {
    version: string
  }
  migrations: {
    latest: {
      tag: string
      idx: number
    }
  }
}

describe('self-hosted backup and restore CLIs', () => {
  it('backs up and restores a self-hosted target with matching data', async () => {
    const source = await buildTemporaryBackupTarget({ integrityIssues: false })
    const tempDir = await mkdtemp(join(tmpdir(), 'libroo-backup-restore-test-'))
    try {
      const outputDir = join(tempDir, 'backups')
      const backup = runScript(scriptPath('scripts/backup-selfhost.mjs'), ['--output-dir', outputDir], {
        env: {
          NUXT_DATABASE_URL: source.databaseUrl,
          NUXT_LOCAL_STORAGE_DIR: source.blobDir,
          NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost'
        }
      })
      expect(backup.status).toBe(0)
      expect(backup.stdout).toContain('Backup complete:')

      const archives = (await readdir(outputDir)).filter(name => name.endsWith('.tar.gz'))
      expect(archives).toHaveLength(1)
      const archivePath = join(outputDir, archives[0])

      const restoredDb = join(tempDir, 'restore', 'sqlite.db')
      const restoredBlob = join(tempDir, 'restore', 'blob')
      const restore = runScript(scriptPath('scripts/restore-selfhost.mjs'), [archivePath], {
        env: {
          NUXT_DATABASE_URL: `file:${restoredDb}`,
          NUXT_LOCAL_STORAGE_DIR: restoredBlob,
          NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost'
        }
      })

      expect(restore.status).toBe(0)
      expect(restore.stdout).toContain('Backup verification passed.')
      expect(restore.stdout).toContain('Restore complete.')
      await expect(readCounts(source.databaseUrl)).resolves.toEqual(await readCounts(`file:${restoredDb}`))
      await expect(readFile(join(restoredBlob, 'covers/manual/user-1/present.webp'), 'utf8')).resolves.toBe('fixture:covers/manual/user-1/present.webp')
    } finally {
      await source.cleanup()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('fails clearly for a nonexistent archive path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'libroo-restore-missing-test-'))
    try {
      const result = runScript(scriptPath('scripts/restore-selfhost.mjs'), [
        join(tempDir, 'missing.tar.gz')
      ], {
        env: {
          NUXT_DATABASE_URL: `file:${join(tempDir, 'sqlite.db')}`,
          NUXT_LOCAL_STORAGE_DIR: join(tempDir, 'blob'),
          NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost'
        }
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/ENOENT|no such file or directory/i)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses to restore into a non-empty target without force', async () => {
    const source = await buildTemporaryBackupTarget({ integrityIssues: false })
    const tempDir = await mkdtemp(join(tmpdir(), 'libroo-restore-refuse-test-'))
    try {
      const archivePath = await makeArchiveFromTarget(source, tempDir, 'manifest-valid.json')
      const targetDb = join(tempDir, 'target', 'sqlite.db')
      const targetBlobFile = join(tempDir, 'target', 'blob', 'existing.txt')
      await mkdir(dirname(targetDb), { recursive: true })
      await writeFile(targetDb, 'existing database')
      await mkdir(dirname(targetBlobFile), { recursive: true })
      await writeFile(targetBlobFile, 'existing blob')

      const result = runScript(scriptPath('scripts/restore-selfhost.mjs'), [archivePath], {
        env: {
          NUXT_DATABASE_URL: `file:${targetDb}`,
          NUXT_LOCAL_STORAGE_DIR: join(tempDir, 'target', 'blob'),
          NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost'
        }
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Refusing to restore into a non-empty target')
    } finally {
      await source.cleanup()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('aborts on an incompatible manifest before modifying the target', async () => {
    const source = await buildTemporaryBackupTarget({ integrityIssues: false })
    const tempDir = await mkdtemp(join(tmpdir(), 'libroo-restore-incompatible-test-'))
    try {
      const archivePath = await makeArchiveFromTarget(source, tempDir, 'manifest-higher-semver.json')
      const targetDb = join(tempDir, 'target', 'sqlite.db')
      const targetBlob = join(tempDir, 'target', 'blob')

      const result = runScript(scriptPath('scripts/restore-selfhost.mjs'), [archivePath], {
        env: {
          NUXT_DATABASE_URL: `file:${targetDb}`,
          NUXT_LOCAL_STORAGE_DIR: targetBlob,
          NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost'
        }
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Refusing to restore an incompatible backup manifest before modifying the target')
      expect(fileExists(targetDb)).toBe(false)
      expect(fileExists(targetBlob)).toBe(false)
    } finally {
      await source.cleanup()
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function readCounts(databaseUrl: string) {
  const client = createClient({ url: databaseUrl })
  try {
    const [books, loans, blobs] = await Promise.all([
      client.execute('select count(*) as count from books'),
      client.execute('select count(*) as count from loans'),
      client.execute('select count(*) as count from user_books')
    ])
    return {
      books: Number(books.rows[0]?.count ?? 0),
      loans: Number(loans.rows[0]?.count ?? 0),
      userBooks: Number(blobs.rows[0]?.count ?? 0)
    }
  } finally {
    client.close()
  }
}

async function makeArchiveFromTarget(
  source: Awaited<ReturnType<typeof buildTemporaryBackupTarget>>,
  tempDir: string,
  manifestFixture: string
) {
  const artifactDir = join(tempDir, `artifact-${manifestFixture}`)
  await mkdir(join(artifactDir, 'database'), { recursive: true })
  await cp(source.databasePath, join(artifactDir, 'database', 'sqlite.db'))
  await cp(source.blobDir, join(artifactDir, 'blob'), { recursive: true })

  if (manifestFixture === 'manifest-valid.json') {
    const manifest = await readJsonFile<ManifestFixture>(join(fixturesDir, manifestFixture))
    const latestMigration = await readLatestMigration(join(repoRoot, 'server/db/migrations/sqlite/meta/_journal.json'))
    if (latestMigration.tag == null || latestMigration.idx == null) {
      throw new Error('Current migration journal must define a latest migration for restore tests')
    }
    manifest.app.version = await readPackageVersion(join(repoRoot, 'package.json'))
    manifest.migrations.latest = latestMigration
    await writeJsonFile(join(artifactDir, 'manifest.json'), manifest)
  } else {
    await copyFixture(manifestFixture, join(artifactDir, 'manifest.json'))
  }

  const archivePath = join(tempDir, `${manifestFixture}.tar.gz`)
  execFileSync('tar', ['-czf', archivePath, '-C', artifactDir, '.'])
  return archivePath
}

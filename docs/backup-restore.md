# Backup And Restore

This is the operator guide for backing up and restoring Libroo data. Libroo has
two runtime profiles, and each profile has two durable units:

- Self-hosted: one SQLite/libSQL database file and one local blob directory.
- Hosted Cloudflare: one D1 database and one R2 bucket.

Capture the database first and blobs second. Book and loan rows contain cover
blob paths, so this order avoids a restored database pointing at blobs that
were not copied yet.

## Manifest

Every backup artifact should contain `manifest.json`, built from
`scripts/lib/backup-metadata.mjs`. The manifest format is versioned separately
from the app so future tooling can detect incompatible metadata.

Current manifest fields:

- `manifestFormatVersion`: manifest schema version.
- `app.version`: canonical app version from `package.json`.
- `runtime.profile`: `selfhost` or `cloudflare`.
- `runtime.*`: runtime details such as Node version, platform, Worker, D1, or
  R2 identifiers when known.
- `timestamps.createdAt`, `timestamps.databaseSnapshotAt`, and
  `timestamps.completedAt`: ISO timestamps for the backup operation.
- `migrations.latest.tag` and `migrations.latest.idx`: latest checked-in
  migration from `server/db/migrations/sqlite/meta/_journal.json`.
- `migrations.applied`: applied self-hosted Drizzle migration rows from
  `__drizzle_migrations` when the source database is directly inspectable.
- `migrations.appliedState`: whether `migrations.applied` was inspected from
  the database or marked unavailable for hosted metadata emitted without direct
  D1 access.

Backups are forward-only. Do not restore a backup whose manifest migration
state or app version is ahead of the code being deployed.

## Self-Hosted Backup

The self-hosted script resolves the same environment variables as the
self-hosted runtime and migration runner:

- `NUXT_DATABASE_URL` or `LIBROO_DATABASE_URL`
- `NUXT_LOCAL_STORAGE_DIR` or `LIBROO_LOCAL_STORAGE_DIR`
- `LIBROO_BACKUP_DIR`, or `--output-dir`

Run:

```bash
pnpm backup:selfhost -- --output-dir /backups/libroo
```

The script:

1. Checks that the output directory is writable and has reasonable free space.
2. Takes an online SQLite snapshot with `VACUUM INTO` into a temporary file.
3. Copies the blob directory, including `.meta.json` sidecars.
4. Writes `manifest.json`.
5. Produces one timestamped archive:
   `libroo-selfhost-backup-YYYY-MM-DDTHH-MM-SSZ.tar.gz`.

Archive layout:

```text
database/sqlite.db
blob/
manifest.json
```

If SQLite reports `SQLITE_FULL`, free Docker Desktop space, prune unused Docker
data, increase Docker's disk image size, or place backups on a larger mounted
volume before retrying.

## Self-Hosted Restore

Restore into a clean target. The script refuses to overwrite a non-empty
database or blob directory unless `--force` is provided.

```bash
pnpm restore:selfhost -- /backups/libroo/libroo-selfhost-backup-2026-06-29T12-00-00Z.tar.gz
```

Use `--force` only after taking a backup of the current target:

```bash
pnpm restore:selfhost -- /backups/libroo/libroo-selfhost-backup-2026-06-29T12-00-00Z.tar.gz --force
```

The restore script:

1. Unpacks the archive.
2. Restores `database/sqlite.db` and `blob/`.
3. Applies checked-in Drizzle migrations through the same migrator path as
   `scripts/migrate-selfhost.mjs`.
4. Runs `scripts/lib/backup-verify.mjs`.
5. Exits non-zero if database health, core table counts, cover-reference
   checks, or manifest compatibility fail.

Verification performs:

- `SELECT 1` database health probe.
- Core table row counts.
- Checks that non-null `books.cover_path` and
  `loans.snapshot_cover_path` values exist on disk.
- Reports blobs not referenced by those cover columns.
- Compares backup app version and latest migration tag/idx against the current
  codebase.

## Hosted Cloudflare Backup

Hosted backups use Cloudflare-native exports plus the same manifest shape.
Capture D1 first, then R2.

```bash
BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "backups/hosted/$BACKUP_ID"

pnpm exec wrangler d1 export libroo-production --remote \
  --output "backups/hosted/$BACKUP_ID/d1.sql"

rclone copy r2-production:libroo-production "backups/hosted/$BACKUP_ID/r2" \
  --checksum --fast-list --log-file "backups/hosted/$BACKUP_ID/r2-copy.log" \
  --log-level INFO

pnpm backup:hosted:manifest -- \
  --output "backups/hosted/$BACKUP_ID/manifest.json" \
  --worker libroo-production \
  --d1-database libroo-production \
  --r2-bucket libroo-production
```

Keep the Wrangler export log, rclone copy/check logs, object counts, and byte
counts next to the manifest. If R2 checksums are unavailable through the chosen
remote, record that verification fell back to key and size comparison.

## Hosted Cloudflare Restore

Restore into clean, non-production D1 and R2 targets first. Do not restore a
backup whose manifest is ahead of the code deployed to the target Worker.

```bash
pnpm exec wrangler d1 create libroo-restore-test
pnpm exec wrangler r2 bucket create libroo-restore-test

pnpm exec wrangler d1 execute libroo-restore-test --remote \
  --file backups/hosted/20260629T120000Z/d1.sql

rclone copy backups/hosted/20260629T120000Z/r2 r2-restore:libroo-restore-test \
  --checksum --fast-list --log-file restore-r2-copy.log --log-level INFO
```

Deploy code that matches or is ahead of the backup manifest and apply
migrations through the normal NuxtHub/Wrangler deployment tooling:

```bash
pnpm build:cloudflare
pnpm exec wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

Verify the restored Worker:

```bash
curl -fsS https://restore-worker.example.com/api/health

pnpm exec wrangler d1 execute libroo-restore-test --remote \
  --command 'select count(*) as count from books'
pnpm exec wrangler d1 execute libroo-restore-test --remote \
  --command 'select count(*) as count from loans'
pnpm exec wrangler d1 execute libroo-restore-test --remote \
  --command 'select id, cover_path from books where cover_path is not null limit 20'
pnpm exec wrangler d1 execute libroo-restore-test --remote \
  --command 'select id, snapshot_cover_path from loans where snapshot_cover_path is not null limit 20'
```

For each sampled cover path, confirm the object exists in the restored R2
bucket. Perform table-count comparisons and cover-reference spot checks before
promoting the restored resources or changing production bindings.

## Online Snapshot Or Stop-Then-Copy

For self-hosted installs, prefer `backup-selfhost.mjs` because it takes a
consistent online database snapshot before copying blobs. A stop-then-copy
backup is also valid when downtime is acceptable:

1. Stop Libroo so no process can write to SQLite or blobs.
2. Copy the database file and blob directory.
3. Generate and store `manifest.json`.
4. Restart Libroo.

Never copy a live SQLite database file directly without `VACUUM INTO`, the
SQLite backup API, or a clean stop.

## Storage And Retention

Recommendations:

- Encrypt backups at rest. Use encrypted disks, object-store server-side
  encryption, or an archive-encryption tool before moving backups off-host.
- Encrypt in transit. Use SSH, HTTPS, S3 TLS endpoints, or a private network
  path.
- Store backups off-host and outside the production volume or bucket.
- Keep at least daily backups for 30 days for the hosted service before public
  launch, with longer legal or business retention only when explicitly
  approved.
- Self-hosted operators should choose their own cadence and retention window
  based on library update frequency and available storage.
- Test restores regularly against disposable targets.
- After restoring an older backup, replay account-deletion requests that
  occurred after the restored backup point before returning the instance to
  normal service.

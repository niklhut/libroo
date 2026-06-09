import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve('server/db/migrations/sqlite/0016_add_locations.sql')

describe('location migration', () => {
  it('enforces uniqueness separately for root locations and child siblings', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toContain(
      'CREATE UNIQUE INDEX `locations_user_parent_name_unique` ON `locations` (`user_id`,`parent_location_id`,`normalized_name`) WHERE `parent_location_id` IS NOT NULL;'
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX `locations_user_root_name_unique` ON `locations` (`user_id`,`normalized_name`) WHERE `parent_location_id` IS NULL;'
    )
  })
})

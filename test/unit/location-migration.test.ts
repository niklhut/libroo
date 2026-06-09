import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve('server/db/migrations/sqlite/0016_add_locations.sql')

describe('location migration', () => {
  it('enforces uniqueness separately for root locations and child siblings', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toMatch(/CREATE UNIQUE INDEX `locations_user_parent_name_unique`/)
    expect(migration).toMatch(/`user_id`,`parent_location_id`,`normalized_name`/)
    expect(migration).toMatch(/WHERE `parent_location_id` IS NOT NULL/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX `locations_user_root_name_unique`/)
    expect(migration).toMatch(/`user_id`,`normalized_name`/)
    expect(migration).toMatch(/WHERE `parent_location_id` IS NULL/)
  })

  it('enforces assigned locations belong to the user book owner', () => {
    const migration = readFileSync(migrationPath, 'utf8')

    expect(migration).toMatch(/CREATE TRIGGER `user_books_location_same_user_insert`/)
    expect(migration).toMatch(/CREATE TRIGGER `user_books_location_same_user_update`/)
    expect(migration).toMatch(/`locations`\.`user_id` = NEW\.`user_id`/)
  })
})

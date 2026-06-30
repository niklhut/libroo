import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  e2ePassword,
  exportSettingsCsv,
  expectLibraryBookMetadata,
  libraryCsvColumns,
  libraryImportFixturePath,
  registerSettingsUser,
  selectSettingsCsvFile
} from './support/settings'
import { login, logout } from './support/auth'

test('changes password and requires the new password on the next login', async ({ page }, testInfo) => {
  const user = await registerSettingsUser(page, testInfo.title, 'settings-password')
  const newPassword = `${e2ePassword}-changed`

  await page.goto('/settings')
  const securityForm = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Change password' })
  })
  await securityForm.locator('input[name="currentPassword"]').fill(e2ePassword)
  await securityForm.locator('input[name="newPassword"]').fill(newPassword)
  await securityForm.locator('input[name="confirmPassword"]').fill(newPassword)
  await securityForm.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password updated', { exact: true }).last()).toBeVisible()

  await logout(page)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click()
  await expect(page.getByText('Invalid email or password', { exact: true }).first()).toBeVisible()

  await login(page, user.email, newPassword)
})

test('exports library data as CSV with the transfer contract columns', async ({ page }, testInfo) => {
  await registerSettingsUser(page, testInfo.title, 'settings-export')
  const title = `Settings Export ${Date.now()}`
  const csv = [
    libraryCsvColumns.join(','),
    [
      title,
      '"[""Export Author""]"',
      '',
      '"[""exported"", ""important""]"',
      'Export Room - Shelf 3',
      'reading',
      '12',
      '20',
      '5',
      'Seeded export note',
      '2026-02-01T12:00:00.000Z',
      '',
      '',
      '',
      ''
    ].join(',')
  ].join('\n')

  const response = await page.request.post('/api/library/import', {
    data: { csv, conflictStrategy: 'csv' }
  })
  expect(response.ok()).toBe(true)

  await page.goto('/settings')
  const exportedCsv = await exportSettingsCsv(page)
  const [header, ...rows] = exportedCsv.trim().split(/\r?\n/)
  expect(header.split(',')).toEqual([...libraryCsvColumns])
  expect(rows.some(row => row.includes(title))).toBe(true)
  expect(exportedCsv).toContain('"[""Exported"",""Important""]"')
  expect(exportedCsv).toContain('Export Room - Shelf 3')
  expect(exportedCsv).toContain(',reading,')
})

test('imports library data from CSV and renders imported metadata', async ({ page }, testInfo) => {
  await registerSettingsUser(page, testInfo.title, 'settings-import')

  await page.goto('/settings')
  await selectSettingsCsvFile(page)
  await expect(page.getByRole('button', { name: /library-import\.csv/ })).toBeVisible()

  await page.getByText('Use CSV data').click()
  const importResponse = page.waitForResponse(response =>
    response.url().includes('/api/library/import') && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Import CSV' }).click()
  await page.getByRole('button', { name: 'Confirm import' }).click()
  const response = await importResponse
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({ created: 1, updated: 0, skipped: 0, failed: [] })
  await expect(page.getByText('Import complete', { exact: true }).last()).toBeVisible()

  const fixtureCsv = await readFile(libraryImportFixturePath, 'utf8')
  expect(fixtureCsv).toContain('Deterministic Settings Import')
  await expectLibraryBookMetadata(page, {
    title: 'Deterministic Settings Import',
    tags: ['Imported', 'Settings'],
    location: 'Main Room - Shelf 7',
    readingStatus: 'reading'
  })
})

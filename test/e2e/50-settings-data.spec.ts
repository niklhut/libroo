import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  e2ePassword,
  confirmSettingsRecentAuth,
  exportSettingsCsv,
  expectLibraryBookMetadata,
  libraryCsvColumns,
  libraryImportFixturePath,
  registerSettingsUser,
  selectSettingsCsvFile
} from './support/settings'
import { login, logout } from './support/auth'
import { LIBRARY_IMPORT_BATCH_SIZE } from '../../shared/utils/library-import-batches'
import { formatLibraryCsv, type LibraryCsvRow } from '../../shared/utils/library-transfer-csv'

test('keeps row details collapsed and identifies a duplicate across import batches', async ({ page }, testInfo) => {
  await registerSettingsUser(page, testInfo.title, 'settings-row-details')
  const title = `Repeated import ${Date.now()}`
  const rows = [...Array.from({ length: LIBRARY_IMPORT_BATCH_SIZE }, (_, index) => index ? `${title} ${index}` : title), title].map(value => ({
    ...Object.fromEntries(libraryCsvColumns.map(column => [column, ''])),
    title: value, authors: '["Import Author"]', library_state: 'owned'
  } as LibraryCsvRow))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name: 'duplicates.csv', mimeType: 'text/csv', buffer: Buffer.from(formatLibraryCsv(rows)) })
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click()
  const report = page.getByRole('dialog', { name: 'Import result', exact: true })
  await expect(report).toContainText(`${LIBRARY_IMPORT_BATCH_SIZE} created, 0 updated, 1 skipped, 0 failed.`)
  await expect(report).toContainText('Already in your library before import: 0 books matched.')
  await expect(report).toContainText('Repeated within this CSV: 1 row matched records handled at an earlier CSV row.')
  await expect(report).toContainText('Repeated rows are included in the updated/skipped totals above')
  await expect(report.getByRole('list', { name: 'Import row details' })).not.toBeVisible()
  await report.getByRole('button', { name: `Show row details (${LIBRARY_IMPORT_BATCH_SIZE + 1})`, exact: true }).click()
  const list = report.getByRole('list', { name: 'Import row details' })
  await expect(list.getByRole('listitem')).toHaveCount(LIBRARY_IMPORT_BATCH_SIZE + 1)
  const repeated = list.getByRole('listitem').filter({ hasText: `Row ${LIBRARY_IMPORT_BATCH_SIZE + 2}:` })
  await expect(repeated).toContainText('Matched')
  await expect(repeated).toContainText('title and author')
  await expect(repeated).toContainText('handled at row 2')
  await expect(repeated.getByRole('link', { name: 'View matched book' })).toHaveAttribute('href', /\/library\//)
  await report.getByRole('combobox', { name: 'Filter import details' }).click()
  await page.getByRole('option', { name: 'Repeated in this CSV', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('import-row-details.png'), fullPage: true })
  await page.setViewportSize({ width: 393, height: 851 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('import-row-details-mobile.png'), fullPage: true })
  await report.getByRole('button', { name: `Hide row details (${LIBRARY_IMPORT_BATCH_SIZE + 1})`, exact: true }).click()
  await expect(list).not.toBeVisible()
})

test('separates pre-import library matches from CSV repeats, including repeats of an existing book', async ({ page, context }, testInfo) => {
  await registerSettingsUser(page, testInfo.title, 'settings-match-origins')
  const existing = `Already owned ${Date.now()}`
  const added = `New in CSV ${Date.now()}`
  expect((await context.request.post('/api/books/manual', { data: { title: existing, authors: ['Import Author'] } })).ok()).toBe(true)
  const rows = [existing, added, existing, added].map((title, index) => ({
    ...Object.fromEntries(libraryCsvColumns.map(column => [column, ''])),
    title, authors: '["Import Author"]', library_state: 'owned', location: `Shelf ${index}`
  } as LibraryCsvRow))
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({ name: 'match-origins.csv', mimeType: 'text/csv', buffer: Buffer.from(formatLibraryCsv(rows)) })
  await page.getByRole('radio', { name: 'Use CSV data', exact: true }).check()
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click()
  const report = page.getByRole('dialog', { name: 'Import result', exact: true })
  await expect(report).toContainText('Row outcomes: 1 created, 3 updated, 0 skipped, 0 failed.')
  await expect(report).toContainText('Already in your library before import: 1 book matched.')
  await expect(report).toContainText('Repeated within this CSV: 2 rows matched records handled at an earlier CSV row.')
  await report.getByRole('button', { name: 'Show row details (4)', exact: true }).click()
  const list = report.getByRole('list', { name: 'Import row details' })
  await report.getByRole('combobox', { name: 'Filter import details' }).click()
  await page.getByRole('option', { name: 'Already in library before import', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('Already in your library before this import.')
  await report.getByRole('combobox', { name: 'Filter import details' }).click()
  await page.getByRole('option', { name: 'Repeated in this CSV', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').first()).toContainText('handled at row 2')
  await expect(list.getByRole('listitem').last()).toContainText('handled at row 3')
})

test('changes password and requires the new password on the next login', async ({ page }, testInfo) => {
  const user = await registerSettingsUser(page, testInfo.title, 'settings-password')
  const newPassword = `${e2ePassword}-changed`

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Change password' }).click()
  await confirmSettingsRecentAuth(page, `${e2ePassword}-wrong`)
  await expect(page.getByText('Password confirmation failed', { exact: true }).last()).toBeVisible()

  await confirmSettingsRecentAuth(page)
  const dialog = page.getByRole('dialog', { name: 'Change password' })
  await dialog.getByLabel('New password', { exact: true }).fill(newPassword)
  await dialog.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
  await dialog.getByRole('button', { name: 'Change password' }).click()
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
      'owned',
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
  await page.getByRole('button', { name: 'Import CSV' }).click()
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
  const resultDialog = page.getByRole('dialog', { name: 'Import result', exact: true })
  await expect(resultDialog).toContainText('1 created, 0 updated, 0 skipped, 0 failed.')
  await resultDialog.getByRole('link', { name: 'View library' }).click()

  const fixtureCsv = await readFile(libraryImportFixturePath, 'utf8')
  expect(fixtureCsv).toContain('Deterministic Settings Import')
  await expectLibraryBookMetadata(page, {
    title: 'Deterministic Settings Import',
    tags: ['Imported', 'Settings'],
    location: 'Main Room - Shelf 7',
    readingStatus: 'reading'
  })
})

test('imports a CSV in small requests and keeps the result report visible', async ({ page }, testInfo) => {
  await registerSettingsUser(page, testInfo.title, 'settings-batched-import')
  const { formatLibraryCsv, libraryCsvColumns: columns, parseLibraryCsv } = await import('../../shared/utils/library-transfer-csv')
  const rows = Array.from({ length: LIBRARY_IMPORT_BATCH_SIZE * 2 + 1 }, (_, i) => ({
    ...Object.fromEntries(columns.map(column => [column, ''])),
    title: `Batched import ${i}`, authors: '["Batch Writer"]', library_state: 'owned', location: `Room ${i % 2}`
  })) as import('../../shared/utils/library-transfer-csv').LibraryCsvRow[]
  const batchSizes: number[] = []
  let releaseSecond!: () => void
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve
  })
  await page.route('**/api/library/import', async (route) => {
    batchSizes.push(parseLibraryCsv(route.request().postDataJSON().csv).length)
    if (batchSizes.length === 2) await secondGate
    await route.continue()
  })
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
    await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from(formatLibraryCsv(rows)) })
    await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm import', exact: true }).click()
    await expect(page.getByText(`Processed ${LIBRARY_IMPORT_BATCH_SIZE} of ${LIBRARY_IMPORT_BATCH_SIZE * 2 + 1} rows. Keep this page open.`, { exact: true })).toBeVisible()
    releaseSecond()
    const report = page.getByRole('dialog', { name: 'Import result', exact: true })
    await expect(report).toContainText(`${LIBRARY_IMPORT_BATCH_SIZE * 2 + 1} created, 0 updated, 0 skipped, 0 failed.`)
    await expect(report).toContainText(`Processed ${LIBRARY_IMPORT_BATCH_SIZE * 2 + 1} of ${LIBRARY_IMPORT_BATCH_SIZE * 2 + 1} rows.`)
    expect(batchSizes).toEqual([LIBRARY_IMPORT_BATCH_SIZE, LIBRARY_IMPORT_BATCH_SIZE, 1])
    await expect(page).toHaveURL(/\/settings$/)
    await report.getByRole('link', { name: 'View library' }).click()
    const lastTitle = `Batched import ${LIBRARY_IMPORT_BATCH_SIZE * 2}`
    await page.getByRole('textbox', { name: 'Search library' }).fill(lastTitle)
    await expect(page.getByRole('heading', { name: lastTitle, exact: true })).toBeVisible()
  } finally {
    releaseSecond()
  }
})

test('reports the invalid book and keeps importing valid books in later batches', async ({ page }, testInfo) => {
  await registerSettingsUser(page, testInfo.title, 'settings-partial-import')
  const { formatLibraryCsv, libraryCsvColumns: columns } = await import('../../shared/utils/library-transfer-csv')
  const rows = Array.from({ length: LIBRARY_IMPORT_BATCH_SIZE + 2 }, (_, i) => ({
    ...Object.fromEntries(columns.map(column => [column, ''])),
    title: `Partial import ${i}`, authors: '["Partial Writer"]', library_state: 'owned', reading_status: i === LIBRARY_IMPORT_BATCH_SIZE ? 'invalid-status' : 'unread'
  })) as import('../../shared/utils/library-transfer-csv').LibraryCsvRow[]
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: 'partial.csv', mimeType: 'text/csv', buffer: Buffer.from(formatLibraryCsv(rows)) })
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click()
  const report = page.getByRole('dialog', { name: 'Import result', exact: true })
  await expect(report).toContainText(`${LIBRARY_IMPORT_BATCH_SIZE + 1} created, 0 updated, 0 skipped, 1 failed.`)
  await expect(report).toContainText(`Processed ${LIBRARY_IMPORT_BATCH_SIZE + 2} of ${LIBRARY_IMPORT_BATCH_SIZE + 2} rows.`)
  await expect(report).not.toContainText('Import stopped early')
  await expect(report.getByRole('list', { name: 'Import row details' })).not.toBeVisible()
  await report.getByRole('button', { name: /Show row details/ }).click()
  await expect(report).toContainText('reading_status must be unread, reading, or read')
  await expect(page).toHaveURL(/\/settings$/)
})

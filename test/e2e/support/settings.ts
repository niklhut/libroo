import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { librarySearchInput } from './selectors'
import { e2ePassword, login, logout, registerUser, uniqueEmail } from './auth'

export { e2ePassword, login, logout, registerUser, uniqueEmail }

export const libraryCsvColumns = [
  'title',
  'authors',
  'isbn',
  'tags',
  'location',
  'library_state',
  'reading_status',
  'current_page',
  'progress_percent',
  'rating',
  'note',
  'added_date',
  'active_loan_status',
  'active_loan_borrower',
  'active_loan_loaned_at',
  'active_loan_due_at'
] as const

export const libraryImportFixturePath = path.resolve('test/e2e/support/fixtures/library-import.csv')

export async function registerSettingsUser(page: Page, testTitle: string, prefix = 'settings') {
  return registerUser(page, {
    email: uniqueEmail(prefix, testTitle),
    password: e2ePassword
  })
}

export async function reloginSettingsUser(page: Page, email: string, password = e2ePassword) {
  await logout(page)
  await login(page, email, password)
}

export async function exportSettingsCsv(page: Page) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  if (!stream) {
    throw new Error('CSV download stream was not available')
  }

  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function selectSettingsCsvFile(page: Page, filePath = libraryImportFixturePath) {
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles(filePath)
}

export async function expectLibraryBookMetadata(page: Page, options: {
  title: string
  tags: string[]
  location: string
  readingStatus: 'unread' | 'reading' | 'read'
}) {
  await page.goto('/library')
  await librarySearchInput(page).fill(options.title)

  const bookLink = page.getByRole('link').filter({
    has: page.getByRole('heading', { name: options.title, exact: true })
  })
  await expect(bookLink).toBeVisible()
  await bookLink.click()
  await expect(page.getByRole('heading', { name: options.title })).toBeVisible()

  const main = page.getByRole('main')
  for (const tag of options.tags) {
    await expect(main.getByText(tag, { exact: true })).toBeVisible()
  }
  await expect(main.getByText(options.location, { exact: true })).toBeVisible()
  await expect(main.getByText(readingStatusLabel(options.readingStatus))).toBeVisible()
}

function readingStatusLabel(status: 'unread' | 'reading' | 'read') {
  if (status === 'read') return /Read .*Finished/
  if (status === 'reading') return /Reading ·/
  return /Unread .*Not started/
}

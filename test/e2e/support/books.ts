import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { addBookTabs } from './selectors'

export const fixtureIsbn = '9780385533225'
export const fixtureIsbnTitle = 'Fixture Driven Development'

export async function addFixtureIsbnBook(page: Page) {
  await addBookTabs(page).gotoIsbn()
  await page.getByLabel('ISBN').fill(fixtureIsbn)
  await page.getByRole('button', { name: 'Look Up Book' }).click()
  await expect(page.getByRole('heading', { name: fixtureIsbnTitle })).toBeVisible()
  await page.getByRole('button', { name: 'Add to Library' }).click()
  await expect(page).toHaveURL(/\/library/)
  await expect(page.getByText(fixtureIsbnTitle)).toBeVisible()
}

export async function addManualBook(page: Page, title: string) {
  await addBookTabs(page).gotoManual()
  await page.getByLabel('Title').fill(title)
  await page.getByPlaceholder('Author name').fill('Manual Author')
  await page.getByLabel('Publisher').fill('Libroo Manual Press')
  await page.locator('input[type="file"]').setInputFiles(path.resolve('test/e2e/fixtures/manual-cover.svg'))
  await expect(page.getByAltText('Selected cover preview')).toBeVisible()
  await page.getByRole('button', { name: 'Add Book' }).click()
  await expect(page).toHaveURL(/\/library\/[^/]+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByAltText(title)).toBeVisible()
}

export async function currentDetailCoverPath(page: Page, title: string) {
  const src = await page.getByAltText(title).first().getAttribute('src')
  if (!src) {
    throw new Error(`Cover image for "${title}" did not render with a src`)
  }

  const url = new URL(src, 'http://127.0.0.1')
  return `${url.pathname}${url.search}`
}

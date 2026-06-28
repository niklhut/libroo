import { expect, test } from '@playwright/test'
import { addManualBook } from './support/books'
import { storageState } from './support/auth'
import { librarySearchInput } from './support/selectors'

test('searches the library, opens a detail page, and persists rating changes', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Searchable Mutation ${testInfo.retry}-${Date.now()}`

  await addManualBook(page, title)
  await page.goto('/library')
  await librarySearchInput(page).fill(title)
  await expect(page.getByText(title)).toBeVisible()

  await page.getByText(title).click()
  await expect(page).toHaveURL(/\/library\/[^/]+$/)
  await page.getByRole('button', { name: 'Rate 4 stars' }).click()
  await expect(page.getByText('4 / 5')).toBeVisible()

  await page.reload()
  await expect(page.getByText('4 / 5')).toBeVisible()
  await context.close()
})

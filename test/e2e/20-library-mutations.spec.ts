import { expect, test } from '@playwright/test'
import { addManualBook } from './support/books'
import { storageState } from './support/auth'
import { bookDetailControls, librarySearchInput } from './support/selectors'

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
  const controls = bookDetailControls(page)
  await controls.ratingStar(4).click()
  await expect(controls.ratingDisplay(4)).toBeVisible()

  await page.reload()
  await expect(controls.ratingDisplay(4)).toBeVisible()
  await context.close()
})

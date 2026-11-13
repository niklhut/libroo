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

  await controls.noteTrigger.click()
  await controls.noteTextarea.fill('Saved with a keyboard shortcut')
  await controls.noteTextarea.press('Meta+Enter')
  await expect(page.getByRole('dialog', { name: 'Personal note' })).not.toBeVisible()
  await expect(page.getByRole('region', { name: 'Personal note' }).getByText('Saved with a keyboard shortcut')).toBeVisible()

  await page.reload()
  await expect(controls.ratingDisplay(4)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Personal note' }).getByText('Saved with a keyboard shortcut')).toBeVisible()
  await context.close()
})

test('immediately removes a deleted book while the library refresh is pending', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Delete without refresh ${Date.now()}`
  const remainingTitle = `Keep after delete ${Date.now()}`
  let releaseRefresh!: () => void
  let markRefreshStarted!: () => void
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve
  })
  try {
    await addManualBook(page, remainingTitle)
    await addManualBook(page, title)
    await page.goto('/library')
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()

    await page.route(/\/api\/books(?:\?|$)/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      markRefreshStarted()
      const response = await route.fetch()
      await refreshGate
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: 'More book actions' }).click()
    await page.getByRole('menuitem', { name: 'No longer own this book' }).click()
    await page.getByRole('dialog', { name: 'No longer own this book?' }).getByRole('button', { name: 'Delete this book' }).click()

    await refreshStarted
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: remainingTitle, exact: true })).toBeVisible()
    const refreshed = page.waitForResponse(response => /\/api\/books\?/.test(response.url()) && response.request().method() === 'GET')
    releaseRefresh()
    await refreshed
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
  } finally {
    releaseRefresh()
    await context.close()
  }
})

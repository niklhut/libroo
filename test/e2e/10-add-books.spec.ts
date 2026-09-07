import { expect, test } from '@playwright/test'
import { addFixtureIsbnBook, addManualBook, bulkFixtureIsbns, fixtureIsbnTitle, libraryBookLink, pasteBulkIsbns } from './support/books'
import { storageState } from './support/auth'
import { addBookTabs } from './support/selectors'

test('submits a pending ISBN prefetch without issuing a second lookup', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  let lookupCount = 0
  let releaseLookup!: () => void
  const responseGate = new Promise<void>((resolve) => {
    releaseLookup = resolve
  })
  await page.route('**/api/books/lookup', async (route) => {
    lookupCount += 1
    await responseGate
    await route.fulfill({ json: {
      found: true, isbn: '9780439362139', title: 'Prefetched Book', author: 'Test Author', coverUrl: null
    } })
  })
  try {
    await addBookTabs(page).gotoIsbn()
    await page.getByLabel('ISBN').fill('9780439362139')
    await expect.poll(() => lookupCount).toBe(1)
    const submit = page.getByRole('button', { name: 'Look Up Book' })
    await expect(submit).toBeEnabled()
    await submit.click()
    releaseLookup()
    await expect(page.getByRole('heading', { name: 'Prefetched Book' })).toBeVisible()
    expect(lookupCount).toBe(1)
  } finally {
    releaseLookup()
    await context.close()
  }
})

test('adds a book by ISBN through the OpenLibrary fixture server', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()

  await addFixtureIsbnBook(page)
  await expect(libraryBookLink(page, fixtureIsbnTitle)).toBeVisible()
  await context.close()
})

test('adds a manual book with an uploaded private cover @mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Manual Cover ${testInfo.retry}`

  await addManualBook(page, title)
  await context.close()
})

test('keeps the bulk review action visible while reviewing a long list @mobile', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()

  await pasteBulkIsbns(page, bulkFixtureIsbns)
  await expect(page.getByText('12 found')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo(0, 0))

  const actionBar = page.getByRole('navigation', { name: 'Add selected books' })
  await expect(actionBar).toBeVisible()
  await expect(actionBar.getByRole('button', { name: 'Add 12 Books to Library' })).toBeVisible()

  await actionBar.getByRole('button', { name: 'Add 12 Books to Library' }).click()
  await expect(page).toHaveURL(/\/library/)
  await expect(libraryBookLink(page, 'Bulk Fixture Book 1')).toBeVisible()
  await context.close()
})

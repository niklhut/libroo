import { expect, test } from '@playwright/test'
import { addFixtureIsbnBook, addManualBook, fixtureIsbnTitle, libraryBookLink } from './support/books'
import { storageState } from './support/auth'

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

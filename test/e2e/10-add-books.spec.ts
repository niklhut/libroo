import { expect, test } from '@playwright/test'
import { addManualBook, bulkFixtureIsbns, fixtureIsbn, fixtureIsbnTitle, libraryBookLink, pasteBulkIsbns } from './support/books'
import { storageState } from './support/auth'
import { addBookTabs } from './support/selectors'

const libraryRefreshPaths = new Set(['/api/books', '/api/preferences', '/api/tags', '/api/locations'])
const libraryBooksPath = '/api/books'

/** Hold the first library refresh that starts after the add response succeeds. */
async function holdPostSaveLibraryRefresh(page: import('@playwright/test').Page, addPath: string) {
  let addCompleted = false
  let releaseRefresh!: () => void
  let refreshSeen!: () => void
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const refreshStarted = new Promise<void>((resolve) => {
    refreshSeen = resolve
  })
  const heldRequests = new Set<Promise<void>>()

  const onResponse = (response: import('@playwright/test').Response) => {
    if (response.url().includes(addPath) && response.request().method() === 'POST' && response.ok()) {
      addCompleted = true
    }
  }
  page.on('response', onResponse)

  const routeHandler = async (route: import('@playwright/test').Route) => {
    const pathname = new URL(route.request().url()).pathname
    const isLibraryRefresh = libraryRefreshPaths.has(pathname)
    if (!addCompleted || route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    if (!isLibraryRefresh) {
      await route.continue()
      return
    }

    const heldRequest = (async () => {
      if (pathname === libraryBooksPath) refreshSeen()
      const response = await route.fetch()
      await refreshReleased
      await route.fulfill({ response })
    })()
    heldRequests.add(heldRequest)
    try {
      await heldRequest
    } finally {
      heldRequests.delete(heldRequest)
    }
  }
  await page.route('**/api/**', routeHandler)

  return {
    refreshStarted,
    async release() {
      releaseRefresh()
      page.off('response', onResponse)
      await Promise.all(heldRequests)
      await page.unroute('**/api/**', routeHandler)
    }
  }
}

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

  const refreshGate = await holdPostSaveLibraryRefresh(page, '/api/books/bulk-add')
  try {
    await page.goto('/library')
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await page.getByRole('link', { name: 'Add Book' }).click()
    await expect(page).toHaveURL(/\/library\/add(?:\?.*)?$/)
    await expect(page.getByText('Find Book by ISBN')).toBeVisible()
    await page.getByLabel('ISBN').fill(fixtureIsbn)
    await page.getByRole('button', { name: 'Look Up Book' }).click()
    await expect(page.getByRole('heading', { name: fixtureIsbnTitle })).toBeVisible()
    await page.getByRole('button', { name: 'Add to Library' }).click()

    await refreshGate.refreshStarted
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await expect(libraryBookLink(page, fixtureIsbnTitle)).toBeVisible()
  } finally {
    await refreshGate.release()
    await context.close()
  }
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
  await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
  await expect(libraryBookLink(page, 'Bulk Fixture Book 1')).toBeVisible()
  await context.close()
})

test('shows bulk added books before the post-save library refresh completes', async ({ browser }) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const refreshGate = await holdPostSaveLibraryRefresh(page, '/api/books/bulk-add')

  try {
    await pasteBulkIsbns(page, bulkFixtureIsbns.slice(0, 2))
    await expect(page.getByText('2 found')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('navigation', { name: 'Add selected books' })
      .getByRole('button', { name: 'Add 2 Books to Library' }).click()

    await refreshGate.refreshStarted
    await expect(page).toHaveURL(/\/library(?:\?.*)?$/)
    await expect(libraryBookLink(page, 'Bulk Fixture Book 1')).toBeVisible()
    await expect(libraryBookLink(page, 'Bulk Fixture Book 2')).toBeVisible()
  } finally {
    await refreshGate.release()
    await context.close()
  }
})

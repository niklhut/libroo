import { expect, test, type Locator } from '@playwright/test'
import { registerUser, storageState } from './support/auth'

async function advanceToNextBatch(shelf: Locator) {
  const next = shelf.getByRole('button', { name: 'Next books', exact: true })
  const initialCount = await shelf.getByTestId('book-card').count()
  for (let step = 0; step <= initialCount; step++) {
    await next.click()
    if (await next.isDisabled() || await shelf.getByTestId('book-card').count() > initialCount) break
  }
}

test('browses cover shelves, filters with tags and remembers the grid layout @mobile', async ({ browser }, testInfo) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    await registerUser(page)
    const locationResponse = await context.request.post('/api/locations', { data: { name: 'Living room' } })
    expect(locationResponse.ok()).toBe(true)
    const location = await locationResponse.json()
    const titles = ['The Hobbit', 'Dune', 'The Left Hand of Darkness', 'The Name of the Rose', 'A Wizard of Earthsea', 'The Secret History', 'Piranesi', 'The Book Thief', 'Jane Eyre', 'Foundation', 'The Odyssey', 'Rebecca', 'The Trial', 'Earthsea', 'The Road', 'Emma', 'The Stranger', 'The Plague', 'Persuasion', 'The Silmarillion']
    for (const [index, title] of titles.entries()) {
      const response = await context.request.post('/api/books/manual', { data: { title, authors: [index % 2 ? 'A. Reader' : 'Ursula Le Guin'], isbn: null, tags: [index % 2 ? 'Fiction' : 'Fantasy', 'Favourites'] } })
      expect(response.ok()).toBe(true)
      const book = await response.json()
      const moved = await context.request.put(`/api/books/${book.id}/location`, { data: { locationId: location.id } })
      expect(moved.ok()).toBe(true)
    }
    await page.goto('/library')
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Shelves', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const shelf = page.getByRole('region', { name: 'Living room books', exact: true })
    await expect(shelf).toBeVisible()
    const first = shelf.getByTestId('book-card').first()
    await expect(first.getByTestId('book-jacket')).toBeVisible()
    await first.getByRole('link').click()
    await expect(page).toHaveURL(/\/library\/[^/?]+$/)
    await page.goto('/library')
    await expect(shelf).toBeVisible()
    const next = page.getByRole('region', { name: 'Living room', exact: true }).getByRole('button', { name: 'Next books', exact: true })
    await expect(next).toBeEnabled()
    const viewportWidth = (await shelf.locator('[data-slot="viewport"]').boundingBox())!.width
    const slideWidth = (await shelf.locator('[data-slot="item"]').first().boundingBox())!.width
    const rowWidth = Math.round(viewportWidth / slideWidth) * slideWidth
    const start = (await first.boundingBox())!.x
    await next.click()
    await expect.poll(async () => Math.abs((await first.boundingBox())!.x - start + rowWidth)).toBeLessThan(3)
    const previous = page.getByRole('region', { name: 'Living room', exact: true }).getByRole('button', { name: 'Previous books', exact: true })
    await expect(previous).toBeEnabled()
    await previous.click()
    await expect.poll(async () => Math.abs((await first.boundingBox())!.x - start)).toBeLessThan(3)
    await page.screenshot({ path: testInfo.outputPath('shelves-light.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(shelf).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('shelves-dark.png'), fullPage: true })
    const loaded = page.waitForResponse(response => /\/api\/books\?/.test(response.url()) && new URL(response.url()).searchParams.get('page') === '2')
    await advanceToNextBatch(page.getByRole('region', { name: 'Living room', exact: true }))
    const nextPage = await (await loaded).json()
    const newBook = shelf.getByRole('link').filter({ has: page.getByRole('heading', { name: nextPage.items[0].title, exact: true }) })
    await expect.poll(async () => {
      const cover = await newBook.boundingBox()
      const viewport = await shelf.locator('[data-slot="viewport"]').boundingBox()
      return !!cover && !!viewport && cover.x >= viewport.x - 2 && cover.x + cover.width <= viewport.x + viewport.width + 2
    }).toBe(true)
    // Remount the shelf at its start before testing a tag on the first card.
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    // Clicking a tag changes the filter without navigating into a book.
    await shelf.getByRole('button', { name: 'Filter by tag: Favourites', exact: true }).first().click()
    await expect(page).toHaveURL(/tags=favourites/)
    await expect(page.getByRole('heading', { name: 'My Library', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    await expect(shelf).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('shelves-desktop.png'), fullPage: true })
  } finally {
    await context.close()
  }
})

test('shows all shelf headings and loads cards only near the viewport', async ({ browser }) => {
  await storageState(browser, 'admin')
  const context = await browser.newContext({ viewport: { width: 800, height: 640 } })
  const page = await context.newPage()
  try {
    await registerUser(page)
    const locations: Record<string, string> = {}
    for (const name of ['Alpha shelves', 'Later shelf', 'Empty shelf']) {
      const response = await context.request.post('/api/locations', { data: { name } })
      expect(response.ok()).toBe(true)
      locations[name] = (await response.json()).id
    }
    // The later shelf and unlocated books are older than an entire global page
    // of Alpha books; they must still appear in the first shelf response.
    for (const [name, count] of [['Later shelf', 14], ['', 2], ['Alpha shelves', 14]] as const) {
      for (let i = 0; i < count; i++) {
        const response = await context.request.post('/api/books/manual', { data: { title: `${name || 'Unlocated'} ${i}`, authors: ['Shelf Author'] } })
        expect(response.ok()).toBe(true)
        const book = await response.json()
        if (name) expect((await context.request.put(`/api/books/${book.id}/location`, { data: { locationId: locations[name] } })).ok()).toBe(true)
      }
    }
    const index = await context.request.get('/api/books', { params: { layout: 'shelf-index', libraryState: 'owned' } })
    expect(await index.json()).toMatchObject({ items: [], pagination: { totalItems: 30 } })
    await page.goto('/library')
    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    const shelfNames = ['Alpha shelves', 'Later shelf', 'No location']
    for (const name of shelfNames) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeAttached()
    }
    await expect(page.getByRole('heading', { name: 'Empty shelf', exact: true })).toHaveCount(0)
    const unlocated = page.getByRole('region', { name: 'No location', exact: true })
    await expect(unlocated.getByTestId('shelf-placeholder')).toBeAttached()
    await expect(unlocated.getByTestId('book-card')).toHaveCount(0)
    await unlocated.scrollIntoViewIfNeeded()
    await expect(unlocated.getByTestId('book-card')).toHaveCount(2)
    for (const name of shelfNames.slice(0, 2)) {
      const shelf = page.getByRole('region', { name, exact: true })
      await shelf.scrollIntoViewIfNeeded()
      await expect(shelf.getByTestId('book-card')).toHaveCount(12)
    }
    await expect(page.getByTestId('book-card')).toHaveCount(26)
    await expect(page.getByText('Showing 26 of 30 books', { exact: true })).toBeVisible()
    for (const [name, totalLoaded] of [['Alpha shelves', 28], ['Later shelf', 30]] as const) {
      await advanceToNextBatch(page.getByRole('region', { name, exact: true }))
      await expect(page.getByTestId('book-card')).toHaveCount(totalLoaded)
      const shelf = page.getByRole('region', { name: `${name} books`, exact: true })
      const firstNewBook = shelf.getByTestId('book-card').nth(12)
      await expect(firstNewBook).toBeInViewport()
    }
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await expect(page.getByText('Showing 12 of 30 books', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load More', exact: true }).click()
    await expect(page.getByText('Showing 24 of 30 books', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Shelves', exact: true }).click()
    for (const name of shelfNames) {
      const shelf = page.getByRole('region', { name, exact: true })
      await shelf.scrollIntoViewIfNeeded()
      await expect(shelf.getByTestId('book-card')).toHaveCount(name === 'No location' ? 2 : 12)
    }
  } finally {
    await context.close()
  }
})

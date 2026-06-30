import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addManualBook, libraryBookLink } from './support/books'
import { storageState } from './support/auth'
import { bookDetailControls, libraryFilters, librarySearchInput, locationsPage } from './support/selectors'

test('mobile library browsing and filtering @mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const runId = `${testInfo.retry}-${Date.now()}`
  const readTitle = `Mobile Filter Read ${runId}`
  const unreadTitle = `Mobile Filter Unread ${runId}`
  const otherTitle = `Mobile Filter Other ${runId}`

  try {
    await addManualBook(page, readTitle)
    await markBookRead(page)
    await addManualBook(page, unreadTitle)
    await addManualBook(page, otherTitle)

    await page.goto('/library')
    await expect(libraryBookLink(page, readTitle)).toBeVisible()
    await expect(libraryBookLink(page, unreadTitle)).toBeVisible()
    await expect(libraryBookLink(page, otherTitle)).toBeVisible()

    await librarySearchInput(page).fill(readTitle)
    await expect(libraryBookLink(page, readTitle)).toBeVisible()
    await expect(libraryBookLink(page, unreadTitle)).not.toBeVisible()

    await librarySearchInput(page).fill('')
    const filters = libraryFilters(page)
    await filters.toggle.click()
    await selectOption(page, filters.readingStatus, 'Read')

    await expect(libraryBookLink(page, readTitle)).toBeVisible()
    await expect(libraryBookLink(page, unreadTitle)).not.toBeVisible()
    await expect(libraryBookLink(page, otherTitle)).not.toBeVisible()
  } finally {
    await context.close()
  }
})

test('mobile detail-page mutation @mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const title = `Mobile Detail Mutation ${testInfo.retry}-${Date.now()}`
  const note = `Mobile note ${testInfo.retry}-${Date.now()}`

  try {
    await addManualBook(page, title)
    await page.goto('/library')
    await librarySearchInput(page).fill(title)
    await libraryBookLink(page, title).click()
    await expect(page).toHaveURL(/\/library\/[^/]+$/)

    const controls = bookDetailControls(page)
    await controls.ratingStar(5).click()
    await expect(controls.ratingDisplay(5)).toBeVisible()

    await controls.noteTrigger.click()
    await controls.noteTextarea.fill(note)
    await controls.noteSave.click()
    await expect(page.getByText(note)).toBeVisible()

    await page.reload()
    await expect(controls.ratingDisplay(5)).toBeVisible()
    await expect(page.getByText(note)).toBeVisible()
  } finally {
    await context.close()
  }
})

test('mobile locations workflow @mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const page = await context.newPage()
  const runId = `${testInfo.retry}-${Date.now()}`
  const topName = `Mobile Shelf ${runId}`
  const childName = `Mobile Bin ${runId}`
  const renamedChildName = `Mobile Renamed Bin ${runId}`

  try {
    const locations = locationsPage(page)
    await page.goto('/library/locations')

    await locations.newTopLevelInput.fill(topName)
    await locations.addLocation.click()
    await expect(locations.node(topName).row).toBeVisible()

    const topNode = locations.node(topName)
    await topNode.add.click()
    await topNode.subLocationInput.fill(childName)
    await topNode.subLocationInput.press('Enter')
    await expect(locations.node(childName).row).toBeVisible()
    await expect(locations.node(childName).row.getByText(`${topName} - ${childName}`)).toBeVisible()

    const childNode = locations.node(childName)
    await childNode.rename.click()
    await childNode.renameInput.fill(renamedChildName)
    await childNode.renameInput.press('Enter')
    await expect(locations.node(renamedChildName).row).toBeVisible()

    const renamedChildNode = locations.node(renamedChildName)
    await renamedChildNode.parentSelect.click()
    await page.getByRole('option', { name: 'Top level' }).click()
    await renamedChildNode.move.click()
    await expect(locations.node(renamedChildName).row.getByText(renamedChildName, { exact: true }).first()).toBeVisible()
    await expect(locations.node(renamedChildName).row).toHaveCSS('margin-left', '0px')

    await locations.node(renamedChildName).delete.click()
    await expect(locations.deleteDialog).toBeVisible()
    await locations.deleteMode.getByRole('radio', { name: 'Clear location from affected books' }).click()
    await locations.confirmDelete.click()
    await expect(locations.node(renamedChildName).row).not.toBeVisible()
  } finally {
    await context.close()
  }
})

async function markBookRead(page: Page) {
  const controls = bookDetailControls(page)
  await controls.readingProgressUpdate.click()
  const dialog = page.getByRole('dialog', { name: 'Update Reading Progress' })
  await dialog.getByRole('button', { name: 'Read', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByText('Read · Finished')).toBeVisible()
}

async function selectOption(page: Page, select: Locator, optionName: string) {
  await select.click()
  await page.getByRole('option', { name: optionName, exact: true }).click()
}

import { expect, test } from '@playwright/test'
import { addFixtureIsbnBook, addManualBook, currentDetailCoverPath, fixtureIsbnTitle, libraryBookLink } from './support/books'
import { registerUser, storageState, uniqueEmail } from './support/auth'
import { adminTables } from './support/selectors'

test('redirects regular users from admin pages and rejects banned users', async ({ browser }, testInfo) => {
  const adminState = await storageState(browser, 'admin')

  const userContext = await browser.newContext()
  const userPage = await userContext.newPage()
  const regular = await registerUser(userPage, {
    email: uniqueEmail('regular', testInfo.title),
    name: 'Regular User'
  })

  await userPage.goto('/admin/users')
  await expect(userPage).toHaveURL(/\/library/)

  const adminContext = await browser.newContext({ storageState: adminState })
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/admin/users')
  const row = adminTables(adminPage).userRow(regular.email)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Ban' }).click()
  await expect(row.getByText('banned')).toBeVisible()

  await userPage.goto('/library')
  await expect(userPage).toHaveURL(/\/login/)
  await adminContext.close()
  await userContext.close()
})

test('enforces private manual cover access and keeps ISBN covers available to signed-in users', async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await registerUser(ownerPage, {
    email: uniqueEmail('cover-owner', testInfo.title),
    name: 'Cover Owner'
  })
  const manualTitle = `Private Cover ${Date.now()}`
  await addManualBook(ownerPage, manualTitle)
  const manualCoverPath = await currentDetailCoverPath(ownerPage, manualTitle)

  const ownerResponse = await ownerPage.request.get(manualCoverPath)
  expect(ownerResponse.ok()).toBe(true)

  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await registerUser(otherPage, {
    email: uniqueEmail('cover-other', testInfo.title),
    name: 'Cover Other'
  })
  const deniedResponse = await otherPage.request.get(manualCoverPath)
  expect(deniedResponse.status()).toBe(404)

  await addFixtureIsbnBook(ownerPage)
  await libraryBookLink(ownerPage, fixtureIsbnTitle).click()
  const isbnCoverPath = await currentDetailCoverPath(ownerPage, fixtureIsbnTitle)
  const isbnResponse = await otherPage.request.get(isbnCoverPath)
  expect(isbnResponse.ok()).toBe(true)

  await otherContext.close()
  await ownerContext.close()
})

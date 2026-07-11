import { expect, test } from '@playwright/test'
import { addManualBook } from './support/books'
import { login, logout, registerUser, uniqueEmail } from './support/auth'

test('does not show account A library state after signing in as account B', async ({ page }, testInfo) => {
  const accountB = await registerUser(page, {
    email: uniqueEmail('state-reset-b', testInfo.title)
  })
  await logout(page)

  const accountA = await registerUser(page, { email: uniqueEmail('state-reset-a', testInfo.title) })
  const accountATitle = `Account A private book ${Date.now()}`
  await addManualBook(page, accountATitle)
  await expect(page.getByText(accountATitle, { exact: true })).toBeVisible()

  await logout(page)
  await login(page, accountB.email)

  await expect(page.getByText('Your library is empty')).toBeVisible()
  await expect(page.getByText(accountATitle, { exact: true })).not.toBeVisible()

  expect(accountA.email).not.toBe(accountB.email)
})

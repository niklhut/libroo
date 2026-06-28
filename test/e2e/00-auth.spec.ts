import { expect, test } from '@playwright/test'
import { login, logout, registerUser, storageState } from './support/auth'

test('first registered user is admin and sessions persist', async ({ browser }) => {
  const statePath = await storageState(browser, 'admin')
  const context = await browser.newContext({ storageState: statePath })
  const page = await context.newPage()

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

  await page.goto('/library')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible()
  await context.close()
})

test('protected route redirects unauthenticated users back after login', async ({ page }) => {
  const account = await registerUser(page)
  await logout(page)

  await page.goto('/library')
  await expect(page).toHaveURL(/\/login\?redirect=%2Flibrary|\/login\?redirect=\/library/)
  await login(page, account.email, account.password, '/library')
  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible()
})

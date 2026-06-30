import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@libsql/client'
import { addManualBook, currentDetailCoverPath } from './support/books'
import { e2ePassword } from './support/settings'
import { e2eEmailRuntimePaths, e2eMailSinkHttpBase } from './support/runtime'
import { login, registerUser, uniqueEmail } from './support/auth'

interface CapturedMail {
  raw: string
}

test('changes email immediately when verification is disabled', async ({ page }, testInfo) => {
  const user = await registerUser(page, {
    email: uniqueEmail('settings-email-direct', testInfo.title)
  })
  const nextEmail = uniqueEmail('settings-email-direct-next', testInfo.title)

  await page.goto('/settings')
  const accountForm = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Change email' })
  })
  await accountForm.locator('input[name="email"]').fill(nextEmail)
  await accountForm.locator('input[name="currentPassword"]').fill(e2ePassword)
  await accountForm.getByRole('button', { name: 'Change email' }).click()
  await expect(page.getByText('Email updated', { exact: true }).last()).toBeVisible()

  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page).toHaveURL(/\/login\?signout=true/)
  await login(page, nextEmail)

  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page).toHaveURL(/\/login\?signout=true/)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click()
  await expect(page.getByText('Invalid email or password', { exact: true }).first()).toBeVisible()
})

test('records pending email changes and resends verification through the local sink @email', async ({ page }, testInfo) => {
  await resetMailSink(page)
  const user = await registerVerifiedEmailUser(page, testInfo.title)
  const pendingEmail = uniqueEmail('settings-pending', testInfo.title)
  const replacementEmail = uniqueEmail('settings-pending-replacement', testInfo.title)

  await page.goto('/settings')
  await submitEmailChange(page, pendingEmail)
  await expect(page.getByText(/Verified|Unverified/, { exact: true })).toBeVisible()
  await expect(page.getByText('Pending email change')).toBeVisible()
  await expect(page.getByText(new RegExp(escapeRegExp(pendingEmail)))).toBeVisible()
  await expectVerificationStatus(page, user.email, pendingEmail)

  await submitEmailChange(page, replacementEmail)
  await expect(page.getByText(new RegExp(escapeRegExp(replacementEmail)))).toBeVisible()
  await expectVerificationStatus(page, user.email, replacementEmail)

  await resetMailSink(page)
  await page.getByRole('button', { name: 'Resend verification email' }).click()
  await expect(page.getByText('Verification email sent', { exact: true }).last()).toBeVisible()
  await expect.poll(async () => (await readMailSink(page)).messages.length).toBeGreaterThan(0)
  const messages = (await readMailSink(page)).messages
  expect(messages.some(message => message.raw.includes(replacementEmail))).toBe(true)
})

test('deletes an account and removes private library data', async ({ page }, testInfo) => {
  const user = await registerUser(page, {
    email: uniqueEmail('settings-delete', testInfo.title)
  })
  const title = `Delete Account Private ${Date.now()}`

  await addManualBook(page, title)
  const privateCoverPath = await currentDetailCoverPath(page, title)
  expect((await page.request.get(privateCoverPath)).ok()).toBe(true)

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Delete account' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
  await dialog.getByLabel('Current password').fill(e2ePassword)
  await dialog.getByLabel('Type DELETE MY ACCOUNT').fill('DELETE MY ACCOUNT')
  await dialog.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page.getByText('Your library is empty')).toBeVisible()
  await expect(page.getByText(title)).not.toBeVisible()
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page).toHaveURL(/\/login\?signout=true/)

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click()
  await expect(page.getByText('Invalid email or password', { exact: true }).first()).toBeVisible()

  const coverResponse = await page.request.get(privateCoverPath)
  expect([401, 404]).toContain(coverResponse.status())
  const booksResponse = await page.request.get('/api/books')
  expect([401, 403]).toContain(booksResponse.status())
})

async function submitEmailChange(page: Page, email: string) {
  const accountForm = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Change email' })
  })
  await accountForm.locator('input[name="email"]').fill(email)
  await accountForm.locator('input[name="currentPassword"]').fill(e2ePassword)
  await accountForm.getByRole('button', { name: 'Change email' }).click()
  await expect(page.getByText('Verification email sent', { exact: true }).last()).toBeVisible()
}

async function expectVerificationStatus(page: Page, email: string, pendingEmail: string) {
  const response = await page.request.get('/api/auth/verification-status')
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    enabled: true,
    email,
    pendingEmail
  })
}

async function registerVerifiedEmailUser(page: Page, testTitle: string) {
  const user = await registerUser(page, {
    email: uniqueEmail('settings-email-verified', testTitle),
    expectedUrl: /\/register/
  })
  await expect(page.getByText('Verify your email')).toBeVisible()
  await setEmailVerified(user.email, true)
  const signInResponse = await page.request.post('/api/auth/sign-in/email', {
    data: {
      email: user.email,
      password: e2ePassword
    }
  })
  expect(signInResponse.ok()).toBe(true)
  await page.goto('/settings')
  return user
}

async function resetMailSink(page: Page) {
  await page.request.post(`${e2eMailSinkHttpBase}/reset`)
}

async function readMailSink(page: Page): Promise<{ messages: CapturedMail[] }> {
  const response = await page.request.get(`${e2eMailSinkHttpBase}/messages`)
  expect(response.ok()).toBe(true)
  return response.json()
}

async function setEmailVerified(email: string, verified: boolean) {
  const client = createClient({ url: `file:${e2eEmailRuntimePaths.databasePath}` })
  try {
    await client.execute({
      sql: 'update user set email_verified = ? where email = ?',
      args: [verified ? 1 : 0, email]
    })
  } finally {
    client.close()
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

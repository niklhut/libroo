import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@libsql/client'
import { addManualBook, currentDetailCoverPath } from './support/books'
import { confirmSettingsRecentAuth, e2ePassword } from './support/settings'
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
  await page.getByRole('button', { name: 'Manage' }).click()
  await confirmSettingsRecentAuth(page)
  const dialog = page.getByRole('dialog', { name: 'Manage email' })
  await dialog.getByLabel('Email').fill(nextEmail)
  await dialog.getByRole('button', { name: 'Change email' }).click()
  await expect(page.getByText('Email updated', { exact: true }).last()).toBeVisible()
  await expect(dialog).toBeHidden()

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
  await expectPendingEmailSummary(page, pendingEmail)
  await expectVerificationStatus(page, user.email, pendingEmail)

  await submitEmailChange(page, replacementEmail)
  await expectPendingEmailSummary(page, replacementEmail)
  await expectVerificationStatus(page, user.email, replacementEmail)

  await resetMailSink(page)
  await page.getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('dialog', { name: 'Manage email' }).getByRole('button', { name: 'Resend verification email' }).click()
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
  await confirmSettingsRecentAuth(page)
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
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
  const dialog = page.getByRole('dialog', { name: 'Manage email' })
  await page.getByRole('button', { name: 'Manage' }).click()
  const recentAuthDialog = page.getByRole('dialog', { name: 'Confirm it’s you' })
  if (await recentAuthDialog.isVisible()) {
    await confirmSettingsRecentAuth(page)
  }
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByRole('button', { name: 'Change email' }).click()
  await expect(page.getByText('Verification email sent', { exact: true }).last()).toBeVisible()
  await expect(dialog).toBeHidden()
}

async function expectPendingEmailSummary(page: Page, pendingEmail: string) {
  await expect(page.getByText(`Changing to ${pendingEmail} — verification pending`, { exact: true })).toBeVisible()
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

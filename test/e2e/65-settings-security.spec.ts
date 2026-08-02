import { expect, test } from '@playwright/test'
import { logout, registerUser } from './support/auth'
import { e2ePassword } from './support/settings'

test('TOTP setup displays a QR code and requires the first code before it is enabled', async ({ page }) => {
  await registerUser(page)
  await page.goto('/settings')

  const twoFactorSection = page.getByRole('heading', { name: 'Two-factor authentication' }).locator('..')
  await twoFactorSection.getByRole('button', { name: 'Set up two-factor authentication' }).click()
  const dialog = page.getByRole('dialog', { name: 'Set up two-factor authentication' })
  await dialog.getByLabel('Current password').fill(e2ePassword)
  await dialog.getByRole('button', { name: 'Continue' }).click()

  await expect(dialog.getByText('Save your recovery codes')).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy all recovery codes' }).click()
  await dialog.getByRole('button', { name: 'I\'ve saved these codes' }).click()
  await expect(dialog.getByAltText('TOTP enrollment QR code')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Verify and finish' })).toBeDisabled()
})

test('passkey controls are hidden when the deployment capability is disabled', async ({ page }) => {
  await registerUser(page)
  await page.goto('/settings')

  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeHidden()
  await logout(page)
  await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeHidden()
})

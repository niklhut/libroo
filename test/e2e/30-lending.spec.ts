import { expect, test } from '@playwright/test'
import { addManualBook } from './support/books'
import { registerUser, storageState, uniqueEmail } from './support/auth'
import { lendingModal, readInviteUrlFromLoanSuccess } from './support/selectors'

test('supports the owner and borrower lending lifecycle', async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext({ storageState: await storageState(browser, 'user') })
  const ownerPage = await ownerContext.newPage()
  const title = `Loan Lifecycle ${testInfo.retry}-${Date.now()}`
  await addManualBook(ownerPage, title)

  const modal = lendingModal(ownerPage)
  await modal.trigger.click()
  await expect(modal.dialog).toBeVisible()
  await modal.borrowerName.fill('Borrower Person')
  await modal.save.click()
  const inviteUrl = await readInviteUrlFromLoanSuccess(ownerPage)

  const borrowerContext = await browser.newContext()
  const borrowerPage = await borrowerContext.newPage()
  await borrowerPage.goto(inviteUrl)
  await expect(borrowerPage.getByText(title)).toBeVisible()
  await borrowerPage.getByRole('link', { name: 'Create account' }).click()
  await registerUser(borrowerPage, {
    email: uniqueEmail('borrower', testInfo.title),
    name: 'Borrower Person',
    useCurrentPage: true,
    expectedUrl: /\/i\/[^/]+$/
  })
  await borrowerPage.getByRole('button', { name: 'Add to borrowed books' }).click()
  await expect(borrowerPage).toHaveURL(/\/library\/loans\?view=borrowed/)
  await expect(borrowerPage.getByText(title)).toBeVisible()
  await expect(borrowerPage.getByText('With you')).toBeVisible()

  await ownerPage.goto('/library/loans')
  await expect(ownerPage.getByText(title)).toBeVisible()
  await ownerPage.getByRole('button', { name: 'Mark returned' }).click()
  await expect(ownerPage.getByText(/^Returned$/).last()).toBeVisible()

  await borrowerPage.reload()
  await expect(borrowerPage.getByText(/^Returned$/).last()).toBeVisible()
  await borrowerContext.close()
  await ownerContext.close()
})

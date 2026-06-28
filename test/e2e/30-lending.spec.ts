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
  const borrowedLoan = borrowerPage.getByRole('article').filter({ hasText: title }).or(
    borrowerPage.locator('[data-slot="root"]').filter({ hasText: title })
  ).first()
  await expect(borrowedLoan.getByText(title)).toBeVisible()
  await expect(borrowedLoan.getByText('With you')).toBeVisible()

  await ownerPage.goto('/library/loans')
  const ownerLoan = ownerPage.getByRole('link', { name: new RegExp(`Open ${escapeRegExp(title)}`) })
  await expect(ownerLoan).toBeVisible()
  await ownerLoan.getByRole('button', { name: 'Mark returned' }).click()
  await expect(ownerPage.getByRole('link', { name: new RegExp(`Open ${escapeRegExp(title)}`) }).getByText(/^Returned$/)).toBeVisible()

  await borrowerPage.reload()
  const returnedBorrowedLoan = borrowerPage.locator('[data-slot="root"]').filter({ hasText: title }).first()
  await expect(returnedBorrowedLoan.getByText(/^Returned$/)).toBeVisible()
  await borrowerContext.close()
  await ownerContext.close()
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

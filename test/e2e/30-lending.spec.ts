import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addManualBook } from './support/books'
import { registerUser, storageState, uniqueEmail } from './support/auth'
import { lendingModal, readInviteUrlFromLoanSuccess } from './support/selectors'

test('supports the owner and borrower lending lifecycle', async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext({ storageState: await storageState(browser, 'user') })
  let borrowerContext: BrowserContext | undefined

  try {
    const ownerPage = await ownerContext.newPage()
    const title = `Loan Lifecycle ${testInfo.retry}-${Date.now()}`
    await addManualBook(ownerPage, title)

    const modal = lendingModal(ownerPage)
    await modal.trigger.click()
    await expect(modal.dialog).toBeVisible()
    await modal.borrowerName.fill('Borrower Person')
    await modal.noteField.fill('Initial private owner note')
    await modal.save.click()
    const inviteUrl = await readInviteUrlFromLoanSuccess(ownerPage)

    borrowerContext = await browser.newContext()
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
    const borrowedLoan = borrowedLoanCard(borrowerPage, title)
    await expect(borrowedLoan.getByText(title)).toBeVisible()
    await expect(borrowedLoan.getByText('With you')).toBeVisible()
    await expect(borrowerPage.getByText('Initial private owner note')).toHaveCount(0)

    await ownerPage.goto('/library/loans')
    const ownerLoan = ownerPage.getByRole('link', { name: new RegExp(`Open ${escapeRegExp(title)}`) })
    await expect(ownerLoan).toBeVisible()
    await expect(ownerLoan.getByRole('button', { name: 'Delete loan record' })).toHaveCount(0)
    await expect(ownerLoan.getByText('Initial private owner note')).toBeVisible()
    await ownerLoan.getByRole('button', { name: 'Edit note' }).click()
    await ownerLoan.getByLabel('Loan note').fill('Updated private owner note')
    await ownerLoan.getByRole('button', { name: 'Save' }).click()
    await expect(ownerLoan.getByText('Updated private owner note')).toBeVisible()
    await ownerLoan.getByRole('button', { name: 'Mark returned' }).click()
    const returnedOwnerLoan = ownerPage.getByRole('link', { name: new RegExp(`Open ${escapeRegExp(title)}`) })
    await expect(returnedOwnerLoan.getByText(/^Returned/)).toBeVisible()
    await expect(returnedOwnerLoan.getByText('Updated private owner note')).toBeVisible()

    await borrowerPage.reload()
    await expect(borrowedLoanCard(borrowerPage, title).getByText(/^Returned$/)).toBeVisible()
    await expect(borrowerPage.getByText('Updated private owner note')).toHaveCount(0)

    await returnedOwnerLoan.getByRole('button', { name: 'Delete loan record' }).click()
    const deleteDialog = ownerPage.getByRole('dialog', { name: 'Delete loan record?' })
    await expect(deleteDialog).toContainText('permanently removed')
    await expect(deleteDialog).toContainText('borrower’s history')
    await deleteDialog.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(returnedOwnerLoan).toHaveCount(0)

    await borrowerPage.reload()
    await expect(borrowedLoanCard(borrowerPage, title)).toHaveCount(0)
  } finally {
    await Promise.allSettled([
      borrowerContext?.close(),
      ownerContext.close()
    ])
  }
})

test('lets an owner cancel an unaccepted loan from the loan actions menu', async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext({ storageState: await storageState(browser, 'user') })

  try {
    const ownerPage = await ownerContext.newPage()
    const title = `Canceled Loan ${testInfo.retry}-${Date.now()}`
    await addManualBook(ownerPage, title)

    const modal = lendingModal(ownerPage)
    await modal.trigger.click()
    await modal.borrowerName.fill('Borrower Person')
    await modal.save.click()

    await ownerPage.goto('/library/loans')
    const ownerLoan = ownerPage.getByRole('link', { name: new RegExp(`Open ${escapeRegExp(title)}`) })
    await expect(ownerLoan).toBeVisible()
    await ownerLoan.getByRole('button', { name: 'More loan actions' }).click()
    await ownerPage.getByRole('menuitem', { name: 'Cancel loan' }).click()

    await expect(ownerLoan.getByText(/^Canceled$/).first()).toBeVisible()
    await expect(ownerLoan.getByRole('button', { name: 'More loan actions' })).toHaveCount(0)
  } finally {
    await ownerContext.close()
  }
})

function borrowedLoanCard(page: Page, title: string) {
  return page.getByRole('article').filter({ hasText: title }).or(
    page.locator('[data-slot="root"]').filter({ hasText: title })
  ).first()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

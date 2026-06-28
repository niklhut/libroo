import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export function addBookTabs(page: Page) {
  return {
    isbnTab: page.getByRole('tab', { name: 'ISBN' }),
    manualTab: page.getByRole('tab', { name: 'Manual' }),
    async gotoIsbn() {
      await page.goto('/library/add?tab=isbn')
      await expect(page).toHaveURL(/\/library\/add\?tab=isbn/)
      await expect(page.getByText('Find Book by ISBN')).toBeVisible()
    },
    async gotoManual() {
      await page.goto('/library/add?tab=manual')
      await expect(page).toHaveURL(/\/library\/add\?tab=manual/)
      await expect(page.getByText('Manual Entry')).toBeVisible()
    }
  }
}

export function librarySearchInput(page: Page) {
  return page.getByLabel('Search library')
}

export function libraryFilters(page: Page) {
  return {
    toggle: page.getByRole('button', { name: /Filters/ }),
    loanStatus: page.getByLabel('Loan status'),
    readingStatus: page.getByLabel('Reading status'),
    tag: page.getByLabel('Filter by tag'),
    locationPath: page.getByLabel('Filter by location path'),
    locationMode: page.getByLabel('Location filter mode'),
    sort: page.getByLabel('Sort library'),
    includeSubLocations: page.getByLabel('Include sub-locations'),
    groupByLocation: page.getByLabel('Group by location')
  }
}

export function lendingModal(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Record a book loan' })
  return {
    trigger: page.getByRole('button', { name: 'Record loan' }),
    dialog,
    borrowerName: dialog.getByLabel('Borrower name'),
    borrowerEmail: dialog.getByLabel('Email (optional)'),
    dueDate: dialog.getByLabel('Due date'),
    save: dialog.getByRole('button', { name: 'Save loan' }),
    inviteAlert: dialog.getByText(/Invite URL:/)
  }
}

export function adminTables(page: Page) {
  return {
    usersTable: page.getByRole('table'),
    userRow(email: string): Locator {
      return page.getByRole('row').filter({ hasText: email })
    }
  }
}

export async function readInviteUrlFromLoanSuccess(page: Page) {
  const alertText = await lendingModal(page).inviteAlert.textContent()
  const match = alertText?.match(/https?:\/\/\S+\/i\/[A-Za-z0-9_-]+/)
  if (!match) {
    throw new Error('Could not find invite URL in lending success alert')
  }
  return match[0]
}

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

export function bookDetailControls(page: Page) {
  return {
    ratingStar(stars: number) {
      return page.getByRole('button', { name: `Rate ${stars} stars` })
    },
    ratingDisplay(stars: number) {
      return page.getByText(`${stars} / 5`)
    },
    noteTrigger: page.getByRole('button', { name: /Add Note|Edit/ }),
    noteTextarea: page.getByPlaceholder('Write your note here...'),
    noteSave: page.getByRole('button', { name: 'Save' }),
    readingProgressUpdate: page.getByRole('button', { name: 'Update' }),
    locationManage: page.getByRole('button', { name: 'Manage' })
  }
}

export function locationsPage(page: Page) {
  const deleteDialog = page.getByRole('dialog', { name: 'Delete location' })

  return {
    newTopLevelInput: page.getByPlaceholder('New top-level location'),
    addLocation: page.getByRole('button', { name: 'Add Location' }),
    node(name: string) {
      const row = page.locator('li > div').filter({ has: page.getByText(name, { exact: true }) })

      return {
        row,
        add: row.getByRole('button', { name: 'Add' }).first(),
        rename: row.getByRole('button', { name: 'Rename' }),
        delete: row.getByRole('button', { name: 'Delete' }),
        move: row.getByRole('button', { name: 'Move' }),
        subLocationInput: row.getByPlaceholder('Sub-location name'),
        renameInput: row.getByPlaceholder('Location name'),
        parentSelect: row.getByRole('combobox')
      }
    },
    deleteDialog,
    deleteMode: deleteDialog.getByRole('radiogroup'),
    confirmDelete: deleteDialog.getByRole('button', { name: 'Delete' })
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

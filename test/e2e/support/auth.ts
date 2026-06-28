import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { e2eRuntimePaths } from './runtime'

export const e2ePassword = 'Libroo-e2e-password-123'

export type E2ERole = 'admin' | 'user'

export function uniqueEmail(prefix: string, testTitle?: string) {
  const slug = (testTitle || 'test')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${prefix}.${slug}.${Date.now()}.${Math.random().toString(36).slice(2)}@e2e.libroo.test`
}

export async function registerUser(page: Page, options: {
  email?: string
  name?: string
  password?: string
  useCurrentPage?: boolean
  expectedUrl?: RegExp
} = {}) {
  const email = options.email ?? uniqueEmail('user')
  const name = options.name ?? email.split('@')[0]
  const password = options.password ?? e2ePassword

  if (!options.useCurrentPage) {
    await page.goto('/register')
  }
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm Password').fill(password)

  const terms = page.getByRole('checkbox')
  if (await terms.count()) {
    await terms.first().check()
  }

  await page.getByRole('button', { name: /create account|continue/i }).click()
  await expect(page).toHaveURL(options.expectedUrl ?? /\/library/)
  return { email, name, password }
}

export async function login(page: Page, email: string, password = e2ePassword, redirect = '/library') {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click()
  await expect(page).toHaveURL(new RegExp(escapeRegExp(redirect)))
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sign Out' }).click()
  await expect(page).toHaveURL(/\/login\?signout=true/)
}

export async function storageState(browser: Browser, role: E2ERole) {
  await mkdir(e2eRuntimePaths.authDir, { recursive: true })

  if (role === 'user') {
    await storageState(browser, 'admin')
  }

  const statePath = join(e2eRuntimePaths.authDir, `${role}.json`)
  if (existsSync(statePath)) return statePath

  const context = await browser.newContext()
  const page = await context.newPage()
  await registerUser(page, {
    email: `${role}@e2e.libroo.test`,
    name: role === 'admin' ? 'E2E Admin' : 'E2E User'
  })
  await context.storageState({ path: statePath })
  await context.close()
  return statePath
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

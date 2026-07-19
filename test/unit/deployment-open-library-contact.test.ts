import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readWorkspaceFile = (pathname: string) => readFileSync(resolve(process.cwd(), pathname), 'utf8')

describe('Open Library deployment identification', () => {
  it('requires and syncs the contact address as a production Worker secret', () => {
    const workflow = readWorkspaceFile('.github/workflows/deploy-cloudflare.yml')

    expect(workflow).toContain('NUXT_OPEN_LIBRARY_CONTACT_EMAIL: ${{ secrets.NUXT_OPEN_LIBRARY_CONTACT_EMAIL }}')
    expect(workflow).toContain('NUXT_OPEN_LIBRARY_CONTACT_EMAIL is required for identified Open Library requests.')
    expect(workflow).toMatch(/const secretNames = \[[\s\S]*'NUXT_OPEN_LIBRARY_CONTACT_EMAIL'[\s\S]*\]/)
  })

  it('requires and syncs a separately scoped preview Worker secret', () => {
    const workflow = readWorkspaceFile('.github/workflows/preview-cloudflare.yml')

    expect(workflow).toContain('NUXT_OPEN_LIBRARY_CONTACT_EMAIL: ${{ secrets.NUXT_OPEN_LIBRARY_CONTACT_EMAIL }}')
    expect(workflow).toContain('Missing preview NUXT_OPEN_LIBRARY_CONTACT_EMAIL.')
    expect(workflow).toContain('NUXT_OPEN_LIBRARY_CONTACT_EMAIL: process.env.NUXT_OPEN_LIBRARY_CONTACT_EMAIL')
  })

  it('does not commit the contact address into canonical preview runtime values', () => {
    const runtimeValues = readWorkspaceFile('scripts/preview/runtime.env')

    expect(runtimeValues).not.toContain('NUXT_OPEN_LIBRARY_CONTACT_EMAIL')
  })
})

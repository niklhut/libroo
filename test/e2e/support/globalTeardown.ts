import { rm } from 'node:fs/promises'
import { e2eRuntimePaths } from './runtime'

export default async function globalTeardown() {
  await rm(e2eRuntimePaths.root, { recursive: true, force: true })
}

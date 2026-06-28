import { rm } from 'node:fs/promises'
import { e2eRuntimePaths } from './runtime'

export default async function globalTeardown() {
  await rm(e2eRuntimePaths.databasePath, { force: true })
  await rm(e2eRuntimePaths.storageDir, { recursive: true, force: true })
}

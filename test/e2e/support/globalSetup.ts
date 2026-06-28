import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { e2eRuntimeEnv, e2eRuntimePaths } from './runtime'

export default async function globalSetup() {
  if (existsSync(e2eRuntimePaths.markerPath)) {
    return
  }

  await rm(e2eRuntimePaths.root, { recursive: true, force: true })
  await mkdir(e2eRuntimePaths.authDir, { recursive: true })
  await mkdir(e2eRuntimePaths.logDir, { recursive: true })
  await mkdir(e2eRuntimePaths.storageDir, { recursive: true })
  await run('node', ['scripts/migrate-selfhost.mjs'], e2eRuntimeEnv)
  await writeFile(e2eRuntimePaths.markerPath, new Date().toISOString())
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

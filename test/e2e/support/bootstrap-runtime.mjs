import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const databaseUrl = process.env.NUXT_DATABASE_URL
if (!databaseUrl?.startsWith('file:')) {
  throw new Error('NUXT_DATABASE_URL must be a file: URL for E2E bootstrap')
}

const databasePath = databaseUrl.slice('file:'.length)
const storageDir = process.env.NUXT_LOCAL_STORAGE_DIR
if (!storageDir) {
  throw new Error('NUXT_LOCAL_STORAGE_DIR must be set for E2E bootstrap')
}

const root = process.env.LIBROO_E2E_TMP_ROOT || dirname(databasePath)
const markerPath = join(root, 'prepared')

await rm(root, { recursive: true, force: true })
await mkdir(join(root, 'auth'), { recursive: true })
await mkdir(join(root, 'logs'), { recursive: true })
await mkdir(storageDir, { recursive: true })
await run('node', ['scripts/migrate-selfhost.mjs'])
await writeFile(markerPath, new Date().toISOString())

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
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

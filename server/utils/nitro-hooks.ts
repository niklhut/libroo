import path from 'node:path'
import fs from 'node:fs'
import type { Nitro } from 'nitropack' // Import necessary types

export function copyDrizzleMigrations(builder: Nitro) {
  const sourceDir = path.resolve(builder.options.rootDir, 'server/db/migrations')
  // The target directory within the .output/server structure
  const targetDir = path.resolve(builder.options.output.dir, 'server/db/migrations')

  if (fs.existsSync(sourceDir)) {
    console.log(`Copying Drizzle migrations from ${sourceDir} to ${targetDir}`)
    fs.cpSync(sourceDir, targetDir, { recursive: true })
  } else {
    console.warn(`Drizzle migrations source directory not found: ${sourceDir}`)
  }
}

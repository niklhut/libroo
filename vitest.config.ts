import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const appDir = fileURLToPath(new URL('./app/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '~': appDir,
      '~~': rootDir,
      '@': appDir,
      '@@': rootDir
    }
  }
})

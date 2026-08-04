/**
 * Resolve the public URL Better Auth uses for redirects and relying-party
 * configuration. Kept separate from the auth instance so configuration
 * consumers do not create a module cycle while Better Auth is initialized.
 */
export function resolveAuthUrl(): string {
  let value = process.env.NUXT_BETTER_AUTH_URL

  try {
    if (typeof useRuntimeConfig === 'function') {
      const runtimeValue = useRuntimeConfig().betterAuthUrl
      if (runtimeValue) value = runtimeValue
    }
  } catch {
    // Runtime config is unavailable in some CLI and test contexts.
  }

  if (!value || value.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        'WARNING: NUXT_BETTER_AUTH_URL is not set in production. '
        + 'Using default http://localhost:3000 which may cause authentication failures.'
      )
    }
    return 'http://localhost:3000'
  }

  return value
}

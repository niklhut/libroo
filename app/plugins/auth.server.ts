import { resolveRequestAuthSession } from '~~/server/utils/auth-session'
import { initializeAuthSession } from '~/utils/auth-session'

export default defineNuxtPlugin(async () => {
  const event = useRequestEvent()
  const authSession = await initializeAuthSession(true, async () => {
    if (!event) {
      throw new Error('Unable to resolve the current SSR request')
    }

    return resolveRequestAuthSession(event)
  })

  return {
    provide: {
      authSession
    }
  }
})

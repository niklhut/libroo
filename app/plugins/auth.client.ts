import { initializeAuthSession } from '~/utils/auth-session'

export default defineNuxtPlugin(async () => {
  return {
    provide: {
      authSession: await initializeAuthSession(false)
    }
  }
})

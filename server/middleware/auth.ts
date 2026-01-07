import { auth } from '../utils/auth'

export default defineEventHandler(async (event) => {
  // // Only check auth for library routes
  // const path = getRequestURL(event).pathname

  // // Skip for non-library routes or API routes
  // if (!path.startsWith('/library') || path.startsWith('/api')) {
  //   return
  // }

  // // Check session on server side using the request
  // const session = await auth.api.getSession({
  //   headers: event.headers
  // })

  // // If no session, redirect to login
  // if (!session?.user) {
  //   return sendRedirect(event, `/auth/login?redirect=${encodeURIComponent(path)}`)
  // }
})

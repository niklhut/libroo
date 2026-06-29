import { Effect } from 'effect'
import { createError, defineEventHandler, getRequestIP, toWebRequest } from 'h3'
import { auth, LIBROO_CLIENT_IP_HEADER } from '../../utils/auth'
import { getEmailCapabilities } from '../../utils/email-capabilities'
import { getEmailVerificationConfig } from '../../utils/email-verification-config'
import { validateEmailVerificationToken } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'
import { runWithExecutionContext } from '../../utils/execution-context'

export default defineEventHandler(async (event) => {
  const executionContext = event.context?.cloudflare?.ctx

  return runWithExecutionContext(executionContext, async () => {
    const request = toWebRequest(event)
    const url = new URL(request.url ?? 'http://localhost/api/auth')
    const verificationEnabled = getEmailVerificationConfig().enabled
    const capabilities = getEmailCapabilities()
    const isEmailSignup = url.pathname.endsWith('/api/auth/sign-up/email') && request.method === 'POST'
    let inviteReservationToken: string | null = null

    if (url.pathname.endsWith('/api/auth/request-password-reset') && request.method === 'POST' && !capabilities.passwordResetEnabled) {
      throw createError({
        statusCode: 404,
        message: 'Password reset email is not available for this deployment. Contact the administrator to reset your password.'
      })
    }

    if (verificationEnabled && url.pathname.endsWith('/api/auth/change-email')) {
      throw createError({
        statusCode: 403,
        message: 'Use account settings to change email'
      })
    }

    if (verificationEnabled && url.pathname.endsWith('/api/auth/verify-email')) {
      const token = url.searchParams.get('token')
      if (token) {
        await runEffect(Effect.gen(function* () {
          return yield* validateEmailVerificationToken(token)
        }))
      }
    }

    if (isEmailSignup) {
      const body = await readSignupBody(request)
      const reservation = await runEffect(Effect.gen(function* () {
        return yield* reserveSignupAttempt({
          token: body?.inviteToken,
          email: body?.email
        })
      }))
      inviteReservationToken = reservation.reservationToken
    }

    let response: Response

    try {
      const authRequest = withResolvedClientIp(request, getRequestIP(event))
      response = await auth.handler(authRequest)
    } catch (error) {
      if (inviteReservationToken) {
        await releaseInviteReservation(inviteReservationToken)
      }
      throw error
    }

    if (isEmailSignup && inviteReservationToken && !response.ok) {
      await releaseInviteReservation(inviteReservationToken)
    }

    if (isEmailSignup && response.ok && inviteReservationToken) {
      const body = await response.clone().json().catch(() => null) as { user?: { id?: string } } | null
      const userId = body?.user?.id

      if (userId) {
        await runEffect(Effect.gen(function* () {
          return yield* acceptSignupInvite(inviteReservationToken, userId)
        }))
      } else {
        await releaseInviteReservation(inviteReservationToken)
      }
    }

    return response
  })
})

function withResolvedClientIp(request: Request, clientIp: string | undefined) {
  if (!clientIp && !request.headers.has(LIBROO_CLIENT_IP_HEADER)) return request

  const headers = new Headers(request.headers)
  if (clientIp) {
    headers.set(LIBROO_CLIENT_IP_HEADER, clientIp)
  } else {
    headers.delete(LIBROO_CLIENT_IP_HEADER)
  }

  return new Request(request, { headers })
}

async function readSignupBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await request.clone().json().catch(() => null) as Record<string, unknown> | null
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.clone().formData().catch(() => null)
    if (!form) return null

    return Object.fromEntries(form.entries())
  }

  return null
}

function releaseInviteReservation(reservationToken: string) {
  return runEffect(Effect.gen(function* () {
    return yield* releaseSignupInviteReservation(reservationToken)
  }))
}

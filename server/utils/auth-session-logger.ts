import type { H3Event } from 'h3'

export const AUTH_SESSION_OUTCOMES = {
  success: 'success',
  unauthenticated: 'unauthenticated',
  failure: 'failure',
  skipped: 'skipped'
} as const

export type AuthSessionOutcome = typeof AUTH_SESSION_OUTCOMES[keyof typeof AUTH_SESSION_OUTCOMES]

export interface AuthSessionResolution {
  status: 'authenticated' | 'unauthenticated' | 'error'
  session: unknown | null
  error?: SafeAuthSessionError
}

export interface SafeAuthSessionError {
  name: string
  message: string
  status?: number
  cause?: string
}

interface AuthSessionLogOptions {
  event: H3Event
  outcome: AuthSessionOutcome
  error?: unknown
  reason?: string
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const SECRET_VALUE_PATTERN = /\b(cookie|token|secret|password|authorization|bearer|session)[^,\s]*/gi

export function logAuthSessionResolution(options: AuthSessionLogOptions) {
  if (options.outcome !== AUTH_SESSION_OUTCOMES.failure) {
    return
  }

  const payload: Record<string, unknown> = {
    component: 'auth-session',
    outcome: options.outcome,
    ...safeRequestMetadata(options.event)
  }

  if (options.reason) {
    payload.reason = redactSensitiveText(options.reason)
  }

  payload.error = summarizeAuthSessionError(options.error)

  const message = formatAuthSessionLogMessage(payload)
  console.warn(message, payload)
}

export function summarizeAuthSessionError(error: unknown): SafeAuthSessionError {
  const record = isRecord(error) ? error : {}
  const cause = record.cause
  const status = extractStatus(error)

  return {
    name: error instanceof Error
      ? error.name
      : typeof record.name === 'string'
        ? record.name
        : typeof error,
    message: redactSensitiveText(errorMessage(error)),
    ...(status ? { status } : {}),
    ...(cause ? { cause: summarizeCause(cause) } : {})
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return String(error)
}

function safeRequestMetadata(event: H3Event) {
  const context = isRecord(event.context) ? event.context : {}
  const cloudflare = isRecord(context.cloudflare) ? context.cloudflare : {}

  return {
    requestId: stringValue(context.requestId ?? context.requestID ?? cloudflare.requestId),
    path: stringValue(event.path ?? event.node?.req.url)
  }
}

function formatAuthSessionLogMessage(payload: Record<string, unknown>) {
  const path = stringValue(payload.path)
  const reason = stringValue(payload.reason)
  const parts = [
    'auth-session',
    stringValue(payload.outcome),
    path ? `path=${redactSensitiveText(path)}` : undefined,
    reason ? `reason=${redactSensitiveText(reason)}` : undefined
  ]

  if (isRecord(payload.error)) {
    const errorName = stringValue(payload.error.name)
    const errorStatus = typeof payload.error.status === 'number' ? payload.error.status : undefined
    if (errorName) parts.push(`error=${redactSensitiveText(errorName)}`)
    if (errorStatus) parts.push(`status=${errorStatus}`)
  }

  return parts.filter(Boolean).join(' ')
}

function extractStatus(error: unknown) {
  if (!isRecord(error)) return undefined

  const response = isRecord(error.response) ? error.response : {}
  const value = error.statusCode ?? error.status ?? response.status
  return typeof value === 'number' ? value : undefined
}

function summarizeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return redactSensitiveText(`${cause.name}: ${cause.message}`)
  }

  if (isRecord(cause)) {
    const name = stringValue(cause.name) ?? 'Object'
    const message = stringValue(cause.message)
    return redactSensitiveText(message ? `${name}: ${message}` : name)
  }

  return redactSensitiveText(String(cause))
}

function redactSensitiveText(value: string) {
  return value
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(SECRET_VALUE_PATTERN, '[redacted-secret]')
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

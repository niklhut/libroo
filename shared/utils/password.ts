import * as z from 'zod'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MIN_LENGTH_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`

export function newPasswordSchema(requiredMessage = 'Password is required') {
  return z.string({ error: requiredMessage })
    .min(1, { error: requiredMessage })
    .min(PASSWORD_MIN_LENGTH, { error: PASSWORD_MIN_LENGTH_MESSAGE })
}

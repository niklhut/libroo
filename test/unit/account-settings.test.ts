import { describe, expect, it } from 'vitest'
import { accountEmailChangeSchema, accountNewPasswordSchema, accountPasswordChangeSchema } from '../../shared/utils/account-settings'
import { newPasswordSchema, PASSWORD_MIN_LENGTH_MESSAGE } from '../../shared/utils/password'

describe('account settings validation', () => {
  it('accepts a valid email change request', () => {
    expect(accountEmailChangeSchema.parse({
      email: 'ada@example.com',
      currentPassword: 'current-password'
    })).toEqual({
      email: 'ada@example.com',
      currentPassword: 'current-password'
    })
  })

  it('rejects invalid email addresses', () => {
    expect(() => accountEmailChangeSchema.parse({
      email: 'not-an-email',
      currentPassword: 'current-password'
    })).toThrow()
  })

  it('requires the current password for email changes', () => {
    expect(() => accountEmailChangeSchema.parse({
      email: 'ada@example.com',
      currentPassword: ''
    })).toThrow()
  })

  it('accepts a valid password change request', () => {
    expect(accountPasswordChangeSchema.parse({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmPassword: 'new-password'
    })).toEqual({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmPassword: 'new-password'
    })
  })

  it('rejects short or mismatched new passwords', () => {
    expect(() => accountPasswordChangeSchema.parse({
      currentPassword: 'current-password',
      newPassword: 'short',
      confirmPassword: 'short'
    })).toThrow()

    expect(() => accountPasswordChangeSchema.parse({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      confirmPassword: 'different-password'
    })).toThrow()
  })

  it('uses the shared new-password rule for account updates', () => {
    expect(accountPasswordChangeSchema.shape.newPassword).toBe(accountNewPasswordSchema)
  })

  it('exposes one shared new-password message for registration and password updates', () => {
    const result = newPasswordSchema().safeParse('short')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(PASSWORD_MIN_LENGTH_MESSAGE)
  })

  it('uses caller-specific required messages for empty new passwords', () => {
    const result = newPasswordSchema('New password is required').safeParse('')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('New password is required')
  })
})

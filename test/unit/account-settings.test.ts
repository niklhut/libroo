import { describe, expect, it } from 'vitest'
import { accountEmailChangeSchema, accountPasswordChangeSchema } from '../../shared/utils/account-settings'

describe('account settings validation', () => {
  it('accepts a valid email change request', () => {
    expect(accountEmailChangeSchema.parse({ email: 'ada@example.com' })).toEqual({
      email: 'ada@example.com'
    })
  })

  it('rejects invalid email addresses', () => {
    expect(() => accountEmailChangeSchema.parse({ email: 'not-an-email' })).toThrow()
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
})

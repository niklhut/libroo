import * as z from 'zod'
import { newPasswordSchema } from './password'

export const accountEmailChangeSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address' }),
  currentPassword: z.string({ error: 'Current password is required' })
    .min(1, { error: 'Current password is required' })
})

export type AccountEmailChangeSchema = z.infer<typeof accountEmailChangeSchema>

export const accountNewPasswordSchema = newPasswordSchema('New password is required')

export const accountPasswordChangeSchema = z.object({
  currentPassword: z.string({ error: 'Current password is required' })
    .min(1, { error: 'Current password is required' }),
  newPassword: accountNewPasswordSchema,
  confirmPassword: z.string({ error: 'Please confirm your new password' })
    .min(1, { error: 'Please confirm your new password' })
}).refine(data => data.newPassword === data.confirmPassword, {
  error: 'Passwords do not match',
  path: ['confirmPassword']
})

export type AccountPasswordChangeSchema = z.infer<typeof accountPasswordChangeSchema>

export const ACCOUNT_DELETION_CONFIRMATION_TEXT = 'DELETE MY ACCOUNT'

export const accountDeletionSchema = z.object({
  currentPassword: z.string({ error: 'Current password is required' })
    .min(1, { error: 'Current password is required' }),
  confirmation: z.string({ error: `Type ${ACCOUNT_DELETION_CONFIRMATION_TEXT} to confirm account deletion` })
    .refine(value => value === ACCOUNT_DELETION_CONFIRMATION_TEXT, {
      error: `Type ${ACCOUNT_DELETION_CONFIRMATION_TEXT} to confirm account deletion`
    })
})

export type AccountDeletionSchema = z.infer<typeof accountDeletionSchema>

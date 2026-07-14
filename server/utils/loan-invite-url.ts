import { Data, Effect } from 'effect'
import { getAuthUrl } from './auth'

export class LoanInviteUrlConfigError extends Data.TaggedError('LoanInviteUrlConfigError')<{
  message: string
}> { }

export function buildLoanInviteUrl(token: string): Effect.Effect<string, LoanInviteUrlConfigError> {
  return Effect.try({
    try: () => new URL(`/i/${token}`, getAuthUrl()).toString(),
    catch: () => new LoanInviteUrlConfigError({ message: 'Loan invite URL is not configured correctly' })
  })
}

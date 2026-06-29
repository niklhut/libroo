export function getApiErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { data?: { message?: string, statusMessage?: string } })?.data?.message
    || (error as { data?: { message?: string, statusMessage?: string } })?.data?.statusMessage
  if (responseMessage) return responseMessage

  if (error instanceof Error && error.name !== 'FetchError') {
    return error.message
  }

  return fallback
}

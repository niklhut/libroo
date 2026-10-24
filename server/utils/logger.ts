import { Cause, Logger, References } from 'effect'

type LogPayload = Record<string, unknown> & {
  level: string
  message: string
  timestamp: Date
}

export const structuredLogger = Logger.make<unknown, undefined>((options) => {
  const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
  const payload: LogPayload = {
    ...annotations,
    level: options.logLevel,
    message: String(options.message),
    timestamp: options.date
  }

  if (options.cause.reasons.length > 0) {
    payload.cause = Cause.pretty(options.cause)
  }

  switch (options.logLevel) {
    case 'Fatal':
    case 'Error':
      console.error(payload)
      break
    case 'Warn':
      console.warn(payload)
      break
    case 'Info':
      console.info(payload)
      break
    case 'Debug':
    case 'Trace':
      console.debug(payload)
      break
    default:
      console.log(payload)
  }

  return undefined
})

export const StructuredLoggerLive = Logger.layer([structuredLogger])

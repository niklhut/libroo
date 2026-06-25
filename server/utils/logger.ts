import { Cause, HashMap, Logger } from 'effect'

type LogPayload = Record<string, unknown> & {
  level: string
  message: string
  timestamp: Date
}

export const structuredLogger = Logger.make<unknown, undefined>((options) => {
  const annotations = HashMap.reduce(
    options.annotations,
    {} as Record<string, unknown>,
    (payload, value, key) => {
      payload[key] = value
      return payload
    }
  )
  const payload: LogPayload = {
    ...annotations,
    level: options.logLevel._tag,
    message: String(options.message),
    timestamp: options.date
  }

  if (!Cause.isEmpty(options.cause)) {
    payload.cause = Cause.pretty(options.cause)
  }

  switch (options.logLevel._tag) {
    case 'Fatal':
    case 'Error':
      console.error(payload)
      break
    case 'Warning':
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

export const StructuredLoggerLive = Logger.replace(
  Logger.defaultLogger,
  structuredLogger
)

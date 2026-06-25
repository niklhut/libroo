import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect, Logger, LogLevel } from 'effect'
import { StructuredLoggerLive } from '../../../../server/utils/logger'

const consoleMethods = ['error', 'warn', 'info', 'debug', 'log'] as const

function spyOnConsole() {
  return Object.fromEntries(
    consoleMethods.map(method => [method, vi.spyOn(console, method).mockImplementation(() => {})])
  ) as Record<(typeof consoleMethods)[number], ReturnType<typeof vi.spyOn>>
}

async function runWithStructuredLogger(effect: Effect.Effect<void>) {
  await Effect.runPromise(
    effect.pipe(
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(StructuredLoggerLive)
    )
  )
}

describe('structuredLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['error', Effect.logError('error message')],
    ['warn', Effect.logWarning('warning message')],
    ['info', Effect.logInfo('info message')],
    ['debug', Effect.logDebug('debug message')]
  ] as const)('routes logs to console.%s with a structured payload', async (method, effect) => {
    const spies = spyOnConsole()

    await runWithStructuredLogger(effect)

    expect(spies[method]).toHaveBeenCalledOnce()
    expect(spies[method]).toHaveBeenCalledWith(expect.objectContaining({
      level: expect.any(String),
      message: expect.any(String)
    }))
  })
})

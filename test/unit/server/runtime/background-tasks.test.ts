import { describe, expect, it, vi } from 'vitest'
import { createBackgroundTaskHandler as createActiveBackgroundTaskHandler } from '../../../../server/runtime/background-tasks.active'
import { createBackgroundTaskHandler as createCloudflareBackgroundTaskHandler } from '../../../../server/runtime/background-tasks.cloudflare'
import { createBackgroundTaskHandler as createSelfhostBackgroundTaskHandler } from '../../../../server/runtime/background-tasks.selfhost'
import { runWithExecutionContext } from '../../../../server/utils/execution-context'

describe('background task runtime handlers', () => {
  it('defers Cloudflare background tasks through waitUntil', () => {
    const waitUntil = vi.fn()
    const handler = createCloudflareBackgroundTaskHandler()
    const promise = Promise.resolve('done')

    runWithExecutionContext({ waitUntil }, () => {
      handler(promise)
    })

    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('logs rejected Cloudflare background tasks with operation context', async () => {
    const waitUntil = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('delivery failed')
    const handler = createCloudflareBackgroundTaskHandler()

    runWithExecutionContext({ waitUntil }, () => {
      handler(Promise.reject(error))
    })

    const deferredPromise = waitUntil.mock.calls[0]?.[0] as Promise<unknown>
    await expect(deferredPromise).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      'Better Auth background task rejected',
      expect.objectContaining({
        severity: 'error',
        operation: 'better-auth.background-task',
        error
      })
    )

    consoleError.mockRestore()
  })

  it('logs and exposes the guarded Cloudflare task when waitUntil is unavailable', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handler = createCloudflareBackgroundTaskHandler()

    const fallbackPromise = handler(Promise.resolve('done'))

    await expect(fallbackPromise).resolves.toBeUndefined()
    expect(consoleWarn).toHaveBeenCalledWith(
      'Better Auth background task missing execution context',
      expect.objectContaining({
        severity: 'warn',
        operation: 'better-auth.background-task'
      })
    )

    consoleWarn.mockRestore()
  })

  it('returns no handler for self-hosted runtime', () => {
    expect(createSelfhostBackgroundTaskHandler()).toBeUndefined()
  })

  it('uses the self-host-safe implementation for direct active-module imports', () => {
    expect(createActiveBackgroundTaskHandler()).toBeUndefined()
  })

  it('lets self-host fallback await rejected work inline', async () => {
    const error = new Error('inline failure')
    const handler = createSelfhostBackgroundTaskHandler()

    await expect(handler ? Promise.resolve(handler(Promise.reject(error))) : Promise.reject(error)).rejects.toThrow('inline failure')
  })
})

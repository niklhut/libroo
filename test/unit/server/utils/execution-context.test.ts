import { describe, expect, it, vi } from 'vitest'
import { getWaitUntil, runWithExecutionContext } from '../../../../server/utils/execution-context'

describe('execution-context bridge', () => {
  it('returns undefined outside an execution context scope', () => {
    expect(getWaitUntil()).toBeUndefined()
  })

  it('returns the scoped waitUntil accessor inside an execution context scope after an async boundary', async () => {
    const waitUntil = vi.fn()

    await runWithExecutionContext({ waitUntil }, async () => {
      await Promise.resolve()
      const scopedWaitUntil = getWaitUntil()
      const promise = Promise.resolve()

      scopedWaitUntil?.(promise)

      expect(waitUntil).toHaveBeenCalledWith(promise)
    })
  })
})

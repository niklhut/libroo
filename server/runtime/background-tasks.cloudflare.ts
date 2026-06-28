import { getWaitUntil } from '../utils/execution-context'

const BACKGROUND_TASK_OPERATION = 'better-auth.background-task'

export function createBackgroundTaskHandler() {
  return (promise: Promise<unknown>) => {
    const deferredPromise = promise.then(
      () => undefined,
      (error) => {
        console.error('Better Auth background task rejected', {
          severity: 'error',
          operation: BACKGROUND_TASK_OPERATION,
          error
        })
      }
    )
    const waitUntil = getWaitUntil()

    if (waitUntil) {
      waitUntil(deferredPromise)
      return
    }

    console.warn('Better Auth background task missing execution context', {
      severity: 'warn',
      operation: BACKGROUND_TASK_OPERATION
    })

    return deferredPromise
  }
}

import { AsyncLocalStorage } from 'node:async_hooks'

type RuntimeExecutionContext = {
  waitUntil?: (promise: Promise<unknown>) => void
}

export const executionContextStorage = new AsyncLocalStorage<RuntimeExecutionContext>()

export function runWithExecutionContext<T>(ctx: RuntimeExecutionContext | undefined, fn: () => T): T {
  if (!ctx) return fn()

  return executionContextStorage.run(ctx, fn)
}

export function getWaitUntil() {
  const store = executionContextStorage.getStore()
  const waitUntil = store?.waitUntil

  return typeof waitUntil === 'function'
    ? waitUntil.bind(store)
    : undefined
}

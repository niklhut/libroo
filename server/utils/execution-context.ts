import { AsyncLocalStorage } from 'node:async_hooks'

type RuntimeExecutionContext = {
  waitUntil?: (promise: Promise<unknown>) => void
}

export const executionContextStorage = new AsyncLocalStorage<RuntimeExecutionContext>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getEventExecutionContext(event: unknown): RuntimeExecutionContext | undefined {
  if (!isRecord(event)) return

  const context = event.context
  if (!isRecord(context)) return

  const waitUntil = context.waitUntil
  if (typeof waitUntil === 'function') {
    return {
      waitUntil: waitUntil.bind(context) as (promise: Promise<unknown>) => void
    }
  }

  const cloudflare = context.cloudflare
  if (!isRecord(cloudflare)) return

  const ctx = cloudflare.ctx
  if (!isRecord(ctx)) return

  const legacyWaitUntil = ctx.waitUntil
  if (typeof legacyWaitUntil !== 'function') return

  return {
    waitUntil: legacyWaitUntil.bind(ctx) as (promise: Promise<unknown>) => void
  }
}

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

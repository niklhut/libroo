import { db } from '@nuxthub/db'
import * as schema from '../db/schema'
import { user } from '../db/schema'

// Better Auth 1.7 reads Drizzle's internal schema metadata while constructing
// its adapter. NuxtHub's Cloudflare database export is request-scoped, so even
// reading `db._` during Nuxt prerendering tries to resolve a D1 binding that is
// not available at build time. Supply static metadata for that one property;
// all database operations still flow through NuxtHub's request-scoped proxy.
export const authAdapterDb = new Proxy(db, {
  get(target, property, receiver) {
    if (property === '_') {
      return { schema: undefined, fullSchema: schema }
    }
    return Reflect.get(target, property, receiver)
  }
})

export { db, schema, user }

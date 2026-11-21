import type { AtomicDbStatement, AtomicDbStatements, DbServiceInterface } from '../services/db.service'

/** Keep each SELECT below D1's parameter limit, with one round trip for large reads. */
export async function readIdsInBatches<Row>(
  database: DbServiceInterface,
  ids: string[],
  select: (db: DbServiceInterface['db'], chunk: string[]) => AtomicDbStatement & PromiseLike<Row[]>
): Promise<Row[]> {
  const uniqueIds = [...new Set(ids)]
  if (!uniqueIds.length) return []
  if (uniqueIds.length <= 75) return await select(database.db, uniqueIds)
  const chunks = Array.from({ length: Math.ceil(uniqueIds.length / 75) }, (_, index) => uniqueIds.slice(index * 75, index * 75 + 75))
  const results = await database.executeAtomic(db => chunks.map(chunk => select(db, chunk)) as unknown as AtomicDbStatements)
  return results.flat() as Row[]
}

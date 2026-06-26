import { Layer } from 'effect'
import { db } from '@nuxthub/db'
import { DbService } from '../../services/db.service'

export const DbServiceCloudflareLive = Layer.sync(DbService, () => ({
  db,
  supportsReliableBatch: false,
  executeAtomic: buildStatements => db.batch(buildStatements(db))
}))

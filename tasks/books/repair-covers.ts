import { Effect } from 'effect'
import { repairMissingOpenLibraryCovers } from '../../server/services/book.service'
import { runEffect } from '../../server/utils/effect'

export default defineTask({
  meta: {
    name: 'books:repair-covers',
    description: 'Try to fetch missing Open Library cover images for existing books.'
  },
  run: async () => {
    const result = await runEffect(Effect.gen(function* () {
      return yield* repairMissingOpenLibraryCovers(20)
    }))

    console.info('Open Library cover repair completed', result)
    return { result }
  }
})

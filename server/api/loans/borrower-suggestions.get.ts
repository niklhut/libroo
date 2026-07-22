import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const { query } = yield* Effect.try({
      try: () => borrowerSuggestionQuerySchema.parse(getQuery(event)),
      catch: error => createError({ statusCode: 400, message: 'Validation Error', data: error })
    })

    return yield* listBorrowerSuggestionsForOwner(user.id, query)
  })
)

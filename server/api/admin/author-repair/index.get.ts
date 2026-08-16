import { Effect } from 'effect'

export default effectHandler((_event, user) =>
  Effect.gen(function* () {
    return {
      candidateCount: yield* getUnknownAuthorRepairCandidateCount(user)
    }
  })
)

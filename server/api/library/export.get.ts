import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const csv = yield* exportLibraryCsv(user.id)
    const date = new Date().toISOString().slice(0, 10)

    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="libroo-library-${date}.csv"`)

    return csv
  })
)

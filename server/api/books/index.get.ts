import { runEffect, Effect } from '../../utils/effect'
import { getLibrary, type UserBook } from '../../repositories/book.repository'
import { requireAuth } from '../../services/auth.service'

export default defineEventHandler(async (event) => {
  return runEffect(
    Effect.gen(function* () {
      // Get authenticated user
      const user = yield* requireAuth(event)

      // Get user's library
      const library = yield* getLibrary(user.id)

      return library.map((userBook: UserBook) => ({
        id: userBook.id,
        bookId: userBook.bookId,
        title: userBook.book.title,
        author: userBook.book.author,
        isbn: userBook.book.isbn,
        coverPath: userBook.book.coverPath,
        addedAt: userBook.addedAt
      }))
    }),
    event
  )
})

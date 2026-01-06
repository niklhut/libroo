import { books } from 'hub:db:schema'
import { blob } from 'hub:blob'

export default defineEventHandler(async (event) => {
  // Validate session
  const session = await auth.api.getSession({
    headers: event.headers
  })

  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized'
    })
  }

  // Parse multipart form data
  const formData = await readMultipartFormData(event)

  if (!formData) {
    throw createError({
      statusCode: 400,
      message: 'Invalid form data'
    })
  }

  // Extract fields from form data
  let title = ''
  let author = ''
  let isbn = ''
  let coverFile: { data: Buffer; type: string; filename: string } | null = null

  for (const field of formData) {
    if (field.name === 'title' && field.data) {
      title = field.data.toString()
    } else if (field.name === 'author' && field.data) {
      author = field.data.toString()
    } else if (field.name === 'isbn' && field.data) {
      isbn = field.data.toString()
    } else if (field.name === 'cover' && field.data && field.type) {
      coverFile = {
        data: field.data,
        type: field.type,
        filename: field.filename || 'cover.jpg'
      }
    }
  }

  // Validate required fields
  if (!title || !author) {
    throw createError({
      statusCode: 400,
      message: 'Title and author are required'
    })
  }

  // Generate unique ID
  const id = crypto.randomUUID()
  const now = new Date()
  let coverPath: string | null = null

  // Upload cover image if provided
  if (coverFile) {
    const blobResult = await blob.put(
      `covers/${session.user.id}/${id}-${coverFile.filename}`,
      coverFile.data,
      { contentType: coverFile.type }
    )
    coverPath = blobResult.pathname
  }

  // Insert book into database
  const db = useDrizzle()

  const newBook = {
    id,
    title,
    author,
    isbn: isbn || null,
    coverPath,
    userId: session.user.id,
    createdAt: now
  }

  await db.insert(books).values(newBook)

  return {
    id: newBook.id,
    title: newBook.title,
    author: newBook.author,
    isbn: newBook.isbn,
    coverPath: newBook.coverPath,
    createdAt: newBook.createdAt
  }
})

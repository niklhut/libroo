import { z } from 'zod'

export const bookIsbnSchema = z.object({
  isbn: z.string({ error: 'ISBN is required' })
    .min(10, { error: 'ISBN must be at least 10 characters' })
    .max(17, { error: 'ISBN is too long' })
})

export type BookIsbnSchema = z.infer<typeof bookIsbnSchema>

export const bookBatchDeleteSchema = z.object({
  ids: z.array(z.string({ error: 'ID must be a string' })).min(1, { error: 'At least one ID is required' })
})

export type BookBatchDeleteSchema = z.infer<typeof bookBatchDeleteSchema>

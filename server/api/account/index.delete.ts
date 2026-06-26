export default defineEventHandler(() => {
  throw createError({
    statusCode: 405,
    message: 'Use POST /api/account/delete to delete an account'
  })
})

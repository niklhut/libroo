import { blob } from 'hub:blob'

export default defineEventHandler(async (event) => {
  // Get the blob pathname from the URL
  const pathname = getRouterParam(event, 'pathname')

  if (!pathname) {
    throw createError({
      statusCode: 400,
      message: 'Pathname is required'
    })
  }

  // Get the blob
  const blobData = await blob.get(pathname)

  if (!blobData) {
    throw createError({
      statusCode: 404,
      message: 'Blob not found'
    })
  }

  // Set content type if available
  setHeader(event, 'Content-Type', blobData.type || 'application/octet-stream')

  // Return the blob as a stream
  return blobData
})

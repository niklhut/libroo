export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    let deleted = 0

    while (true) {
      const page = await env.BLOB.list()
      if (page.objects.length === 0) {
        break
      }
      if (page.objects.length > 0) {
        await env.BLOB.delete(page.objects.map(object => object.key))
        deleted += page.objects.length
      }
    }

    return Response.json({ deleted })
  }
}

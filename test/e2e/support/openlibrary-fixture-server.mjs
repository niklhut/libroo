import { createServer } from 'node:http'
import bulkFixtureIsbns from './fixtures/bulk-isbns.json' with { type: 'json' }

const port = Number(process.env.LIBROO_OPENLIBRARY_FIXTURE_PORT || 3011)
const fixtureIsbn = '9780385533225'
const cover = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<rect width="400" height="600" fill="#0f766e"/>
<rect x="34" y="34" width="332" height="532" fill="#f8fafc"/>
<rect x="58" y="58" width="284" height="484" fill="#134e4a"/>
<text x="200" y="210" text-anchor="middle" font-family="Arial" font-size="34" fill="#ffffff">Fixture</text>
<text x="200" y="260" text-anchor="middle" font-family="Arial" font-size="34" fill="#ffffff">Library</text>
<text x="200" y="330" text-anchor="middle" font-family="Arial" font-size="22" fill="#ccfbf1">OpenLibrary Cover</text>
<text x="200" y="380" text-anchor="middle" font-family="Arial" font-size="18" fill="#ccfbf1">ISBN ${fixtureIsbn}</text>
<desc>${'deterministic cover fixture '.repeat(80)}</desc>
</svg>`)

const books = Object.fromEntries([fixtureIsbn, ...bulkFixtureIsbns].map((isbn, index) => [isbn, {
  title: index === 0 ? 'Fixture Driven Development' : `Bulk Fixture Book ${index}`,
  authors: [{ name: 'Ada Example' }],
  publishers: ['Libroo Test Press'],
  publish_date: '2026',
  number_of_pages: 321,
  covers: [index + 1],
  key: `/books/OL-E2E-${index + 1}M`,
  works: [{ key: `/works/OL-E2E-${index + 1}W` }],
  subjects: ['Testing', 'Libraries']
}]))

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

  if (url.pathname === '/health') {
    sendJson(response, { ok: true })
    return
  }

  if (url.pathname === '/api/books') {
    if (url.searchParams.get('jscmd') !== 'details') {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'The fixture only supports jscmd=details' }))
      return
    }
    const bibkeys = (url.searchParams.get('bibkeys') || '').split(',')
    const body = Object.fromEntries(bibkeys.flatMap((bibkey) => {
      const isbn = bibkey.replace(/^ISBN:/, '')
      const book = books[isbn]
      return book ? [[bibkey, { details: book }]] : []
    }))
    sendJson(response, body)
    return
  }

  const workMatch = url.pathname.match(/^\/works\/OL-E2E-(\d+)W\.json$/)
  if (workMatch) {
    const workIndex = Number.parseInt(workMatch[1], 10)
    sendJson(response, {
      key: `/works/OL-E2E-${workIndex}W`,
      title: workIndex === 1 ? 'Fixture Driven Development' : `Bulk Fixture Book ${workIndex - 1}`,
      description: 'A deterministic OpenLibrary fixture used by Libroo end-to-end tests.',
      subjects: ['Testing', 'Libraries', 'Offline systems']
    })
    return
  }

  const allowedCoverPaths = new Set(Object.keys(books).flatMap(isbn => [
    `/b/isbn/${isbn}-S.jpg`,
    `/b/isbn/${isbn}-M.jpg`,
    `/b/isbn/${isbn}-L.jpg`
  ]))
  if (allowedCoverPaths.has(url.pathname)) {
    response.writeHead(200, {
      'content-type': 'image/svg+xml',
      'content-length': String(cover.length),
      'cache-control': 'no-store'
    })
    response.end(cover)
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'Fixture not found' }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`OpenLibrary fixture server listening on http://127.0.0.1:${port}`)
})

function sendJson(response, body) {
  response.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(body))
}

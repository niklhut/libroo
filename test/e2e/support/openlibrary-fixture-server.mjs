import { createServer } from 'node:http'

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

const books = {
  [fixtureIsbn]: {
    title: 'Fixture Driven Development',
    authors: [{ name: 'Ada Example' }],
    publishers: [{ name: 'Libroo Test Press' }],
    publish_date: '2026',
    number_of_pages: 321,
    cover: {
      small: `/b/isbn/${fixtureIsbn}-S.jpg?default=false`,
      medium: `/b/isbn/${fixtureIsbn}-M.jpg?default=false`,
      large: `/b/isbn/${fixtureIsbn}-L.jpg?default=false`
    },
    key: '/books/OL-E2E-1M',
    subjects: [{ name: 'Testing' }, { name: 'Libraries' }]
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

  if (url.pathname === '/health') {
    sendJson(response, { ok: true })
    return
  }

  if (url.pathname === '/api/books') {
    const bibkeys = (url.searchParams.get('bibkeys') || '').split(',')
    const body = Object.fromEntries(bibkeys.flatMap((bibkey) => {
      const isbn = bibkey.replace(/^ISBN:/, '')
      const book = books[isbn]
      return book ? [[bibkey, book]] : []
    }))
    sendJson(response, body)
    return
  }

  if (url.pathname === '/books/OL-E2E-1M.json') {
    sendJson(response, { works: [{ key: '/works/OL-E2E-1W' }] })
    return
  }

  if (url.pathname === '/works/OL-E2E-1W.json') {
    sendJson(response, {
      key: '/works/OL-E2E-1W',
      title: 'Fixture Driven Development',
      description: 'A deterministic OpenLibrary fixture used by Libroo end-to-end tests.',
      subjects: ['Testing', 'Libraries', 'Offline systems']
    })
    return
  }

  const allowedCoverPaths = new Set([
    `/b/isbn/${fixtureIsbn}-S.jpg`,
    `/b/isbn/${fixtureIsbn}-M.jpg`,
    `/b/isbn/${fixtureIsbn}-L.jpg`
  ])
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

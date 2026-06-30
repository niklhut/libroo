import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'

const smtpPort = Number(process.env.LIBROO_MAIL_SINK_SMTP_PORT || 3013)
const httpPort = Number(process.env.LIBROO_MAIL_SINK_HTTP_PORT || 3014)
const messages = []

const smtpServer = createTcpServer((socket) => {
  let dataMode = false
  let rawMessage = ''
  let current = createEnvelope()

  socket.setEncoding('utf8')
  socket.write('220 libroo-e2e-mail-sink ESMTP\r\n')

  socket.on('data', (chunk) => {
    if (dataMode) {
      rawMessage += chunk
      if (rawMessage.includes('\r\n.\r\n') || rawMessage.endsWith('\n.\r\n') || rawMessage.endsWith('\n.\n')) {
        rawMessage = rawMessage.replace(/\r?\n\.\r?\n$/, '')
        messages.push(parseMessage({ ...current, raw: rawMessage }))
        dataMode = false
        rawMessage = ''
        current = createEnvelope()
        socket.write('250 Message accepted\r\n')
      }
      return
    }

    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      const upper = line.toUpperCase()
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        socket.write('250-libroo-e2e-mail-sink\r\n250 PIPELINING\r\n')
      } else if (upper.startsWith('MAIL FROM:')) {
        current.from = extractAddress(line)
        socket.write('250 OK\r\n')
      } else if (upper.startsWith('RCPT TO:')) {
        current.to.push(extractAddress(line))
        socket.write('250 OK\r\n')
      } else if (upper === 'DATA') {
        dataMode = true
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
      } else if (upper === 'RSET') {
        current = createEnvelope()
        socket.write('250 OK\r\n')
      } else if (upper === 'QUIT') {
        socket.write('221 Bye\r\n')
        socket.end()
      } else if (upper === 'NOOP') {
        socket.write('250 OK\r\n')
      } else {
        socket.write('250 OK\r\n')
      }
    }
  })
})

const httpServer = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

  if (url.pathname === '/health') {
    sendJson(response, { ok: true })
    return
  }

  if (url.pathname === '/messages') {
    sendJson(response, { messages })
    return
  }

  if (url.pathname === '/reset' && request.method === 'POST') {
    messages.splice(0, messages.length)
    sendJson(response, { ok: true })
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'Not found' }))
})

smtpServer.listen(smtpPort, '127.0.0.1', () => {
  console.log(`Mail sink SMTP listening on 127.0.0.1:${smtpPort}`)
})

httpServer.listen(httpPort, '127.0.0.1', () => {
  console.log(`Mail sink HTTP listening on http://127.0.0.1:${httpPort}`)
})

function createEnvelope() {
  return { from: '', to: [], raw: '' }
}

function extractAddress(line) {
  return line.replace(/^[^:]+:/, '').trim().replace(/^<|>$/g, '')
}

function parseMessage(message) {
  const [rawHeaders, ...bodyParts] = message.raw.split(/\r?\n\r?\n/)
  const headers = {}
  for (const line of rawHeaders.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/)
    if (match) headers[match[1].toLowerCase()] = match[2]
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    receivedAt: new Date().toISOString(),
    from: message.from,
    to: message.to,
    subject: headers.subject || '',
    raw: message.raw,
    text: bodyParts.join('\n\n')
  }
}

function sendJson(response, body) {
  response.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(body))
}

const [command, requestedName] = process.argv.slice(2)
export async function listQueues(fetcher, accountId, apiToken) {
  const queues = []
  for (let page = 1; ; page++) {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/queues?page=${page}&per_page=100`, { headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' } })
    const body = await response.json()
    if (!response.ok || !body.success) throw new Error(`Unable to list Cloudflare Queues: ${body.errors?.map(error => error.message).join('; ') || response.statusText}`)
    queues.push(...(body.result ?? []))
    if (!body.result_info || page >= body.result_info.total_pages) return queues
  }
}

export async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')
  if (!['list', 'ensure'].includes(command)) throw new Error('Usage: node scripts/cloudflare/queues.mjs <list|ensure> [queue-name]')
  if (command === 'ensure' && !/^libroo-enrichment-(?:production|pr-\d+)$/.test(requestedName ?? '')) throw new Error(`Unsafe enrichment Queue name: ${requestedName}`)
  const queues = await listQueues(fetch, accountId, apiToken)
  if (command === 'list') process.stdout.write(JSON.stringify(queues))
  else {
    const headers = { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' }
    if (queues.some(queue => queue.queue_name === requestedName)) {
      process.stdout.write(JSON.stringify({ queue_name: requestedName, created: false }))
    } else {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/queues`, { method: 'POST', headers, body: JSON.stringify({ queue_name: requestedName }), signal: AbortSignal.timeout(15_000) })
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error(`Unable to create Queue ${requestedName}: ${body.errors?.map(error => error.message).join('; ') || response.statusText}`)
      process.stdout.write(JSON.stringify({ queue_name: requestedName, created: true }))
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()

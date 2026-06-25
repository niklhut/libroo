const workerName = process.argv[2]
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN

if (!accountId || !apiToken) {
  throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')
}
if (!/^libroo-pr-\d+$/.test(workerName)) {
  throw new Error(`Unsafe preview Worker name: ${workerName}`)
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${workerName}?force=true`,
  {
    method: 'DELETE',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  }
)

if (response.status === 404) {
  process.stdout.write(JSON.stringify({
    name: workerName,
    deleted: false,
    alreadyAbsent: true
  }))
  process.exit(0)
}

const body = await response.json()
if (!response.ok || !body.success) {
  const details = body.errors?.map(error => error.message).join('; ')
    || `${response.status} ${response.statusText}`
  throw new Error(`Unable to delete preview Worker ${workerName}: ${details}`)
}

process.stdout.write(JSON.stringify({
  name: workerName,
  deleted: true,
  alreadyAbsent: false
}))

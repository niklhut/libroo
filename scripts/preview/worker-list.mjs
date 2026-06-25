const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN

if (!accountId || !apiToken) {
  throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
  {
    headers: {
      Authorization: `Bearer ${apiToken}`
    }
  }
)
const body = await response.json()

if (!response.ok || !body.success) {
  const details = body.errors?.map(error => error.message).join('; ')
    || `${response.status} ${response.statusText}`
  throw new Error(`Unable to list Cloudflare Workers: ${details}`)
}

const workers = body.result
  .map(worker => worker.id)
  .filter(name => /^libroo-pr-\d+$/.test(name))
  .sort()

process.stdout.write(JSON.stringify(workers))

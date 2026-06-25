const command = process.argv[2]
const applicationName = process.argv[3]
const hostname = process.argv[4]
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
const policyId = process.env.CLOUDFLARE_ACCESS_POLICY_ID
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps`
const previewNamePattern = /^libroo-preview-pr-\d+$/
const previewHostnamePattern = /^libroo-pr-\d+\.[a-z0-9-]+\.workers\.dev$/

if (!accountId || !apiToken) {
  throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')
}

async function cloudflareRequest(path = '', options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })
  const body = await response.json()

  if (!response.ok || !body.success) {
    const details = body.errors?.map(error => error.message).join('; ')
      || `${response.status} ${response.statusText}`
    throw new Error(`Cloudflare Access API request failed: ${details}`)
  }

  return body
}

async function listApplications() {
  const applications = []
  let page = 1

  while (true) {
    const body = await cloudflareRequest(`?page=${page}&per_page=100`)
    applications.push(...body.result)
    if (!body.result_info || page >= body.result_info.total_pages) {
      return applications
    }
    page += 1
  }
}

async function upsertApplication() {
  if (!policyId) {
    throw new Error('CLOUDFLARE_ACCESS_POLICY_ID is required')
  }
  if (!previewNamePattern.test(applicationName)) {
    throw new Error(`Unsafe preview Access application name: ${applicationName}`)
  }
  if (!previewHostnamePattern.test(hostname)) {
    throw new Error(`Unsafe preview Access hostname: ${hostname}`)
  }

  const existing = (await listApplications())
    .filter(application => application.name === applicationName)
  if (existing.length > 1) {
    throw new Error(`Multiple Access applications are named ${applicationName}`)
  }

  const payload = {
    name: applicationName,
    type: 'self_hosted',
    domain: hostname,
    destinations: [{ type: 'public', uri: hostname }],
    policies: [{ id: policyId, precedence: 1 }],
    app_launcher_visible: false,
    http_only_cookie_attribute: true,
    same_site_cookie_attribute: 'strict',
    session_duration: '24h',
    skip_interstitial: true
  }
  const body = existing.length === 1
    ? await cloudflareRequest(`/${existing[0].id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })
    : await cloudflareRequest('', {
        method: 'POST',
        body: JSON.stringify(payload)
      })

  process.stdout.write(JSON.stringify({
    id: body.result.id,
    name: body.result.name,
    domain: body.result.domain,
    audience: body.result.aud
  }))
}

async function deleteApplication() {
  if (!previewNamePattern.test(applicationName)) {
    throw new Error(`Unsafe preview Access application name: ${applicationName}`)
  }

  const matching = (await listApplications())
    .filter(application => application.name === applicationName)
  for (const application of matching) {
    await cloudflareRequest(`/${application.id}`, { method: 'DELETE' })
  }

  process.stdout.write(JSON.stringify({
    name: applicationName,
    deleted: matching.length
  }))
}

async function listPreviewApplications() {
  const applications = (await listApplications())
    .filter(application => previewNamePattern.test(application.name))
    .map(application => ({
      id: application.id,
      name: application.name,
      domain: application.domain,
      audience: application.aud
    }))
  process.stdout.write(JSON.stringify(applications))
}

switch (command) {
  case 'upsert':
    await upsertApplication()
    break
  case 'delete':
    await deleteApplication()
    break
  case 'list':
    await listPreviewApplications()
    break
  default:
    throw new Error('Usage: access-app.mjs <upsert|delete|list> [name] [hostname]')
}

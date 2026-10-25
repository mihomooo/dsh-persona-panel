// Create the v0.4.6 GitHub release and upload the prebuilt tarball.
// Token comes from GITHUB_TOKEN in the environment; it is never printed.
import { readFileSync } from 'node:fs'

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('GITHUB_TOKEN missing')
  process.exit(1)
}
const owner = 'mihomooo'
const repo = 'dsh-persona-panel'
const tag = process.argv[2] || 'v0.4.6'
const name = process.argv[3] || `${tag.slice(1)} — 记忆按挡位读取`
const notesPath = 'C:/Users/YTYisJWYdaddy/Desktop/ds/persona-plugin/docs/market/release-notes-0.4.6.md'
const assetPath = 'C:/Users/YTYisJWYdaddy/Desktop/ds/persona-plugin/dsh-persona-panel.tgz'
const assetName = 'dsh-persona-panel.tgz'
const api = 'https://api.github.com'
const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'dsh-agent',
  Accept: 'application/vnd.github+json',
}

const body = readFileSync(notesPath, 'utf8')

const createRes = await fetch(`${api}/repos/${owner}/${repo}/releases`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name, body, draft: false, prerelease: false }),
})
const created = await createRes.json()
if (!createRes.ok) {
  console.error('create failed', createRes.status, JSON.stringify(created).slice(0, 500))
  process.exit(1)
}
console.log(`release created: ${created.tag_name} (id ${created.id}) ${created.html_url}`)

const asset = readFileSync(assetPath)
const uploadUrl = created.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(assetName)}`)
const upRes = await fetch(uploadUrl, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/gzip', 'Content-Length': String(asset.length) },
  body: asset,
})
const uploaded = await upRes.json()
if (!upRes.ok) {
  console.error('upload failed', upRes.status, JSON.stringify(uploaded).slice(0, 500))
  process.exit(1)
}
console.log(`asset uploaded: ${uploaded.name} ${uploaded.size} bytes`)
console.log(`download: ${uploaded.browser_download_url}`)

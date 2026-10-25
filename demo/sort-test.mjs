// The workspace list used to re-sort itself every time the panel was opened or a
// row was clicked: `ensureWorkspace()` stamped `lastSeen` on every read, and the
// list is ordered by it — so the row you clicked jumped to the top. This test
// pins the fix: reads are inert, only a real turn moves a workspace.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-sort-'))

const { apply } = await import('../index.js')

let handler = null
let section = null
const fakeCtx = {
  get: () => undefined,
  tools: { register: () => {} },
  systemPrompt: { section: (opts) => { section = opts } },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
}
apply(fakeCtx, {})

const dirA = 'C:\\tmp\\sort-alpha'
const dirB = 'C:\\tmp\\sort-beta'
let token = null
let sessions = 0

function fakeReq(body, headers, url) {
  const buf = Buffer.from(body ? JSON.stringify(body) : '')
  return {
    method: body ? 'POST' : 'GET',
    url: url || '/persona-panel/api',
    headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { if (buf.length) yield buf },
  }
}
async function call(body, dir) {
  const payload = body ? { ...body, dir: dir || dirA } : null
  const h = payload
    ? { origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin', 'x-persona-token': token }
    : {}
  const out = {}
  const url = payload ? '/persona-panel/api' : `/persona-panel/api?dir=${encodeURIComponent(dir || '')}`
  await handler(fakeReq(payload, h, url), { writeHead(s) { out.s = s }, end(p) { out.b = p ? JSON.parse(p) : null } })
  if (out.b?.token) token = out.b.token
  return out.b
}
// Snapshot only stamps `lastSeen` when the panel asks to *be* that workspace.
const panelOpen = (dir) => call(null, dir)
// A real turn: the prompt renderer runs with this workspace's session.
const turn = (dir) => section.text({ agent: { id: `sess-${++sessions}`, session: { header: { cwd: dir } } } })

const results = []
const ok = (name, cond) => {
  results.push([name, !!cond])
  if (!cond) console.log('FAIL', name)
}
const order = async () => ((await panelOpen(dirA)).workspaces || []).map((w) => w.dir.split('\\').pop()).join(',')

// Workspaces exist because each had a turn; alpha spoke first, beta second.
turn(dirA)
await new Promise((r) => setTimeout(r, 5))
turn(dirB)

ok('two workspaces listed', (await panelOpen(dirA)).workspaces.length === 2)
ok('newest activity first', (await order()) === 'sort-beta,sort-alpha')
ok('opening the panel does not reorder', (await order()) === 'sort-beta,sort-alpha')
ok('clicking the other row does not reorder', (await panelOpen(dirB)) && (await order()) === 'sort-beta,sort-alpha')

// A turn in alpha, later than beta's, moves alpha back to the top.
await new Promise((r) => setTimeout(r, 5))
turn(dirA)
ok('a newer turn wins', (await order()) === 'sort-alpha,sort-beta')
ok('reads still do not reorder', (await order()) === 'sort-alpha,sort-beta')

let failed = 0
for (const [name, good] of results) {
  if (!good) failed += 1
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${name}`)
}
console.log(`\n${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)

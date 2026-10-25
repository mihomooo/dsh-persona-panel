// Archiving must be undoable: the snapshot comes back merged into the workspace,
// not replacing whatever was written after the archive.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-archive-'))

const { apply } = await import('../index.js')

let handler = null
const fakeCtx = {
  get: () => undefined,
  tools: { register: () => {} },
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
}
apply(fakeCtx, {})

const dirA = 'C:\\tmp\\archive-a'

function fakeReq(body, headers, url) {
  const buf = Buffer.from(body ? JSON.stringify(body) : '')
  return {
    method: body ? 'POST' : 'GET',
    url: url || '/persona-panel/api',
    headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { if (buf.length) yield buf },
  }
}
function fakeRes() {
  const out = {}
  return { writeHead(s) { out.status = s; return this }, end(p) { out.body = p ? JSON.parse(p) : null }, out }
}
let token = null
async function call(body) {
  const payload = body ? { ...body, dir: dirA } : null
  const h = {}
  if (payload) { h.host = '127.0.0.1:1234'; h.origin = 'http://127.0.0.1:1234'; h['sec-fetch-site'] = 'same-origin'; h['x-persona-token'] = token }
  const res = fakeRes()
  await handler(fakeReq(payload, h, payload ? '/persona-panel/api' : `/persona-panel/api?dir=${encodeURIComponent(dirA)}`), res)
  if (res.out.body && res.out.body.token) token = res.out.body.token
  return res.out
}
const snap = async () => (await call(null)).body

const results = []
const ok = (name, cond, extra) => { results.push([name, !!cond]); if (!cond) console.log('FAIL', name, extra ?? '') }

await call(null)
await call({ op: 'firstRun', settings: { agentName: '测试酱', userCall: '老大', level: 'active' } })
await call({ op: 'settings', settings: { level: 'active' } })
await call({ op: 'addNote', text: '归档前的人设补充' })
await call({ op: 'addUser', text: '归档前的印象' })
await call({ op: 'addEvent', text: '归档前的约定', date: '10-26' })

let s = await snap()
ok('three entries before archive', s.store.self.length + s.store.user.length + s.store.event.length === 3, JSON.stringify(s.store).slice(0, 120))

await call({ op: 'archive' })
s = await snap()
ok('archive empties the lists', s.store.self.length === 0 && s.store.user.length === 0 && s.store.event.length === 0)
ok('archive leaves one orphan', s.orphans.length === 1, s.orphans.length)
ok('orphan keeps the count', s.orphans[0].n === 3, s.orphans[0].n)
const orphanId = s.orphans[0].id

// Written after the archive: restoring must keep it.
await call({ op: 'addNote', text: '归档后新写的' })
s = await snap()
ok('new entry while archived', s.store.self.filter((x) => x.kind === 'note').length === 1)

await call({ op: 'restoreArchive', id: orphanId })
s = await snap()
const notes = s.store.self.filter((x) => x.kind === 'note').map((x) => x.text)
ok('orphan gone after restore', s.orphans.length === 0, s.orphans.length)
ok('archived note restored', notes.includes('归档前的人设补充'), notes)
ok('new note survived', notes.includes('归档后新写的'), notes)
ok('no duplicate notes', notes.length === 2, notes.length)
ok('archived user restored', s.store.user.some((x) => x.text === '归档前的印象'), s.store.user.length)
ok('archived event restored', s.store.event.some((x) => x.text === '归档前的约定'), s.store.event.length)

// Restoring twice is a no-op, not a duplication.
await call({ op: 'restoreArchive', id: orphanId })
s = await snap()
ok('second restore is a no-op', s.store.self.filter((x) => x.kind === 'note').length === 2, s.store.self.length)

// The button lives in settings, so the client must know the op exists.
const client = (await import('node:fs')).readFileSync(new URL('../client.js', import.meta.url), 'utf8')
ok('client sends restoreArchive', client.includes("op: 'restoreArchive'"))
ok('client labels it 找回', client.includes('找回'))

const bad = results.filter(([, pass]) => !pass).length
console.log(`${results.length - bad}/${results.length} archive checks passed`)
process.exit(bad ? 1 : 0)

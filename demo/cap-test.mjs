// Event ceiling: default 20, configurable, 0 = unlimited, over-cap writes queue a
// card instead of landing, starred entries bypass the ceiling and sort first.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-cap-'))

const { apply } = await import('../index.js')

let handler = null
let section = null
const tools = {}
const fakeCtx = {
  get: () => undefined,
  tools: { register: (def) => { tools[def.name] = def } },
  systemPrompt: { section: (opts) => { section = opts } },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
}

apply(fakeCtx, {})

const dir = 'C:\\tmp\\cap-ws'
const exec = { agent: { id: 'session-1', session: { header: { cwd: dir } } } }

function fakeReq(body, headers) {
  const buf = Buffer.from(body ? JSON.stringify(body) : '')
  return {
    method: body ? 'POST' : 'GET',
    url: '/persona-panel/api',
    headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { if (buf.length) yield buf },
  }
}
function fakeRes() {
  const out = {}
  return {
    writeHead(s) { out.status = s; return this },
    end(p) { out.body = p ? JSON.parse(p) : null },
    out,
  }
}
async function call(body, headers) {
  const res = fakeRes()
  await handler(fakeReq(body, headers), res)
  return res.out
}

const first = await call(null, {})
const auth = { 'x-persona-token': first.body.token, origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin' }
const post = (body) => call({ dir, ...body }, auth)
const snap = async () => (await call(null, auth)).body
const remember = (args) => tools.persona_remember.execute(args, exec)

const say = (label, value) => console.log(`${label}: ${value}`)
const ok = (label, cond) => { say(label, cond); if (!cond) process.exitCode = 1 }

const s0 = await snap()
ok('default cap 20', s0.settings.eventsCap === 20)

await post({ op: 'settings', settings: { level: 'auto', eventsCap: 3 } })

for (const text of ['第一件事：约好周末去山里', '第二件事：项目收尾', '第三件事：心情很好']) {
  await remember({ kind: 'event', text, eventKind: 'promise' })
}
let s = await snap()
ok('three stored', s.store.event.length === 3)

const over = await remember({ kind: 'event', text: '第四件事：不该直接落盘' })
s = await snap()
ok('over-cap not stored', s.store.event.length === 3)
ok('over-cap reports cap', /上限|满了/.test(over.text))
ok('queued as capFull', s.store.pending.filter((p) => p.kind === 'capFull').length === 1)

const starred = await remember({ kind: 'event', text: '第五件事：特别重要', important: true, eventKind: 'precious' })
s = await snap()
ok('important bypasses cap', s.store.event.length === 4)
ok('important flag kept', s.store.event[0].important === true)
ok('important reports stored', /记下/.test(starred.text))

await post({ op: 'raiseCap', value: 10 })
s = await snap()
ok('raised cap', s.settings.eventsCap === 10)
ok('queued item moved in', s.store.event.length === 5)
ok('pending emptied', s.store.pending.length === 0)

const askedId = s.store.event.find((e) => e.text.startsWith('第四件事')).id
await post({ op: 'markEvent', id: askedId, important: true })
s = await snap()
ok('star toggled', s.store.event.filter((e) => e.important).length === 2)

const text = section.text({ agent: exec.agent })
ok('star in prompt', text.includes('★ 第五件事'))
ok('starred first', text.indexOf('★ 第五件事') < text.indexOf('第一件事') < 0 || text.indexOf('★ 第五件事') < text.indexOf('- 第一件事'))

await post({ op: 'raiseCap', value: 0 })
s = await snap()
ok('unlimited accepted', s.settings.eventsCap === 0)
const last = await remember({ kind: 'event', text: '第六件事：不限之后随便写' })
s = await snap()
ok('unlimited writes through', s.store.event.length === 6 && /记下/.test(last.text))

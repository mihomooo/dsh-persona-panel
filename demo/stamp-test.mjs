// Entries are found again by two things: the day they happened (with a year, so
// January does not merge two years) and a headline short enough to scan. Both
// used to be missing: dates went in as a bare MM-DD, and nothing carried a title.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-stamp-'))

const { apply } = await import('../index.js')

let handler = null
const tools = {}
const fakeCtx = {
  get: () => undefined,
  tools: { register: (def) => { tools[def.name] = def } },
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
}
apply(fakeCtx, {})

const dirA = 'C:\\tmp\\stamp-a'
const execA = { agent: { id: 'sess-stamp', session: { header: { cwd: dirA } } } }

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

const results = []
const ok = (name, cond, extra) => { results.push([name, !!cond, extra]); if (!cond) console.log('FAIL', name, extra ?? '') }
const year = String(new Date().getFullYear())

await call(null)
await call({ op: 'firstRun', settings: { agentName: '测试酱', userCall: '老大', level: 'active' } })

// A bare MM-DD is what the old prompt asked for; it must come back with a year.
const remembered = await tools.persona_remember.execute(
  { kind: 'event', text: '把插件发上市场', date: '10-27', title: '上市', eventKind: 'work', evidence: '用户说「可以更新了」' },
  execA,
)
ok('event write accepted', !remembered.error, remembered.text)

const store = (await call(null)).body.store
const event = (store.event || [])[0]
ok('date is expanded with the year', event && event.date === `${year}-10-27`, event && event.date)
ok('title is kept', event && event.title === '上市', event && event.title)
ok('evidence is kept', event && event.ev && event.ev[0] === '用户说「可以更新了」', event && event.ev)

const full = await tools.persona_recall.execute({ depth: 'all' }, execA)
ok('recall shows the headline', full.text.includes('「上市」'))
ok('recall shows the year', full.text.includes(`${year}-10-27`))

const found = await tools.persona_recall.execute({ query: '上市' }, execA)
ok('search finds it by the headline', found.text.includes('上市'))
ok('search shows the year too', found.text.includes(`${year}-10-27`))

// The same rules on the panel path: adding an event from the UI, then retitling it.
const added = await call({ op: 'addEvent', text: '面板里记的一件事', date: `${year - 1}-12-31`, title: '跨年' })
ok('panel add keeps the title', !!added.body && added.body.ok !== false)
const after = (await call(null)).body.store
const panelEvent = (after.event || [])[0]
ok('panel date survives as written', panelEvent && panelEvent.date === `${year - 1}-12-31`, panelEvent && panelEvent.date)
ok('panel title survives', panelEvent && panelEvent.title === '跨年', panelEvent && panelEvent.title)

await call({ op: 'updateEntry', id: panelEvent.id, title: '跨年那晚' })
const edited = (await call(null)).body.store.event.find((x) => x.id === panelEvent.id)
ok('title can be rewritten', edited && edited.title === '跨年那晚', edited && edited.title)

await call({ op: 'updateEntry', id: edited.id, date: '03-01' })
const reDated = (await call(null)).body.store.event.find((x) => x.id === panelEvent.id)
ok('a month-day edit gains the year', reDated && reDated.date === `${year}-03-01`, reDated && reDated.date)

const passed = results.filter((r) => r[1]).length
console.log(`${passed}/${results.length} checks passed`)
if (passed !== results.length) process.exit(1)

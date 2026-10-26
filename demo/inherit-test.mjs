// Workspace settings are partial by design: a workspace only stores what was
// changed there. Anything absent falls back to the template in db.settings —
// otherwise a fresh workspace would read as "no name, manual level" and the
// settings dialog would show blanks while the agent behaved otherwise.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'pp-inherit-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'persona-panel'), { recursive: true })

const dir = 'C:\\tmp\\inherit-ws'
const db = {
  version: 1,
  seq: 10,
  firstRun: true,
  lastDir: dir,
  settings: {
    level: 'auto',
    features: {
      self: { on: true, rec: true },
      user: { on: true, rec: true },
      event: { on: true, rec: true },
      diary: { on: true, rec: true },
      others: { on: false, rec: false },
    },
    lexicon: ['耐心'],
    eventsCap: 20,
    agentName: '烟测',
    userCall: '阿测',
  },
  workspaces: {
    // Partial on purpose: only the ceiling was ever written here.
    [dir]: { storeId: 's1', title: '继承', lastSeen: 2, from: '', settings: { eventsCap: 7 } },
  },
  stores: {
    s1: { self: [], user: [], event: [], diary: [], pending: [], others: [], cap: 7 },
  },
  sessions: {},
  pendingImport: null,
  orphans: [],
  profiles: [],
}
writeFileSync(join(home, 'persona-panel', 'db.json'), JSON.stringify(db))

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

const results = []
const ok = (name, cond, extra) => {
  results.push([name, cond])
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${extra ?? ''}`}`)
}

const first = await call(null, {})
const auth = { 'x-persona-token': first.body.token, origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin' }
const snap = async () => (await call(null, auth)).body
const post = (body) => call({ dir, ...body }, auth)

const s = (await snap()).settings || {}
ok('a partial workspace inherits the level', s.level === 'auto', s.level)
ok('a partial workspace inherits the agent name', s.agentName === '烟测', s.agentName)
ok('a partial workspace inherits how I am called', s.userCall === '阿测', s.userCall)
ok('the workspace keeps its own ceiling', s.eventsCap === 7, s.eventsCap)

await post({ op: 'settings', settings: { level: 'manual', userCall: '' } })
const s2 = (await snap()).settings || {}
ok('a value written here wins over the template', s2.level === 'manual', s2.level)
ok('an explicitly emptied name stays empty', s2.userCall === '', JSON.stringify(s2.userCall))
ok('untouched keys still fall back', s2.agentName === '烟测', s2.agentName)

const failed = results.filter((r) => !r[1])
console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)

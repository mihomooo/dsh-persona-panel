// persona_recall 的 query：人都按词回想（「跟猫有关的那件事」），不按日子。
// 这里钉住：一个词能网到、多个词是交集、日期片段能搜、四类都参与、
// 没命中的时候不编一条出来。
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-query-'))

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

const dir = 'C:\\tmp\\query-ws'
const exec = { agent: { id: 'sess-q', session: { header: { cwd: dir } } } }

function fakeReq(body, headers, url) {
  const buf = Buffer.from(body ? JSON.stringify(body) : '')
  return {
    method: body ? 'POST' : 'GET',
    url: url || '/persona-panel/api',
    headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { if (buf.length) yield buf },
  }
}
let token = null
async function call(body) {
  const payload = { ...body, dir }
  const out = {}
  await handler(
    fakeReq(payload, { origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin', 'x-persona-token': token }),
    { writeHead(s) { out.s = s }, end(p) { out.b = p ? JSON.parse(p) : null } },
  )
  if (out.b?.token) token = out.b.token
  return out.b
}
async function snapshot() {
  const out = {}
  await handler(
    fakeReq(null, {}, `/persona-panel/api?dir=${encodeURIComponent(dir)}`),
    { writeHead(s) { out.s = s }, end(p) { out.b = p ? JSON.parse(p) : null } },
  )
  if (out.b?.token) token = out.b.token
  return out.b
}
await snapshot()
await call({ op: 'settings', settings: { level: 'auto' } })

const results = []
const ok = (name, cond, extra) => {
  results.push([name, !!cond])
  if (!cond) console.log('FAIL', name, extra === undefined ? '' : extra)
}

const write = async (args) => (await tools.persona_remember.execute(args, exec))?.text || ''

await write({ kind: 'self', label: '护短', intensity: 3, text: '对身边的人护着，尤其护着猫的事' })
await write({ kind: 'self', hard: true, text: '不许把猫的生日忘了' })
await write({ kind: 'self', kind: 'note', text: '下雨天会想起旧房子的窗台' })
await write({ kind: 'user', text: '养了一只叫团子的猫，橘色' })
await write({ kind: 'event', text: '答应给团子换猫爬架', date: '10-25' })
await write({ kind: 'event', text: '项目验收通过', date: '11-02' })
await write({ kind: 'diary', text: '今天猫在窗台上睡了一下午' })
await write({ kind: 'diary', text: '夜里想了很多以前的事' })

const recall = async (args) => (await tools.persona_recall.execute(args, exec))?.text || ''

const cat = await recall({ query: '猫' })
ok('one word nets every kind that mentions it', cat.includes('护短') && cat.includes('团子') && cat.includes('猫爬架') && cat.includes('窗台上睡了一下午'), cat.slice(0, 160))
ok('it reports how many hit', /记忆里和「猫」有关的：\d+ 条/.test(cat), cat.split('\n')[0])
ok('rows still carry their ids', /⟨[a-z]\d+⟩/.test(cat), cat.slice(0, 120))

const and = await recall({ query: '猫 爬架' })
ok('two words are an intersection, not a union', and.includes('猫爬架') && !and.includes('团子在窗台上'), and.slice(0, 200))

const dated = await recall({ query: '11-02' })
ok('a date fragment finds the dated event', dated.includes('项目验收通过') && !dated.includes('猫爬架'), dated.slice(0, 120))

const mixed = await recall({ query: '团子 橘色' })
ok('a word can hit the impression section alone', mixed.includes('养了一只叫团子的猫') && !mixed.includes('猫爬架'), mixed.slice(0, 160))

const miss = await recall({ query: '量子力学' })
ok('no hit says so instead of inventing', miss.includes('没有') && miss.includes('换个词'), miss.slice(0, 120))

// 大概符合: the words are in the right order but not glued together. People
// remember "夜…以前", not the sentence as it was written.
const loose = await recall({ query: '夜里以前' })
ok('out-of-order gaps still find the line', loose.includes('夜里想了很多以前的事'), loose.slice(0, 200))
ok('loose hits say they are approximate', loose.includes('大概'), loose.slice(0, 200))

// But a word that is simply absent is still a miss: fuzzy is not "any word wins".
const half = await recall({ query: '猫 量子' })
ok('one missing word is still a miss', half.includes('没有'), half.slice(0, 160))

const plain = await recall({})
ok('no query still returns the whole drawer', plain.includes('我记着的事') && plain.includes('我写下的字') && plain.includes('我眼里的'), plain.slice(0, 80))

let failed = 0
for (const [name, good] of results) {
  if (!good) failed += 1
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${name}`)
}
console.log(`\n${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)

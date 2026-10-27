// 「记录提醒」的契约：连着几轮没记东西就在对话尾部补一句话，写了一条就重新
// 计数，一个会话最多两次，关掉就完全不出现，而且只在每轮第一步注入。
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'pp-nudge-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

const dir = 'C:\\tmp\\nudge-ws'
let handler = null
let section = null
const tools = new Map()
const listeners = new Map()

const fakeCtx = {
  get: () => undefined,
  tools: { register: (t) => { tools.set(t.name, t); return () => {} } },
  systemPrompt: { section: (o) => { section = o; return () => {} } },
  effect: (fn) => fn(),
  on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name) },
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
}
apply(fakeCtx, {})

const results = []
const ok = (name, cond, extra) => {
  results.push([name, !!cond])
  if (!cond) console.log('FAIL', name, extra === undefined ? '' : extra)
}

let token = null
async function api(body) {
  const out = {}
  await handler(
    {
      method: body ? 'POST' : 'GET',
      url: `/persona-panel/api?dir=${encodeURIComponent(dir)}`,
      headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', 'x-persona-token': token || '' },
      async *[Symbol.asyncIterator]() {
        if (body) yield Buffer.from(JSON.stringify(body))
      },
    },
    { writeHead(s) { out.s = s }, end(p) { out.b = p ? JSON.parse(p) : null } },
  )
  if (out.b?.token) token = out.b.token
  return out.b
}

const preStep = listeners.get('agent/pre-step')
ok('pre-step hook is registered', typeof preStep === 'function')

const open = (id) => section.text({ agent: { id, session: { header: { cwd: dir } } } })
const step = async (id, turn, stepNo = 1) =>
  preStep({ agent: { id }, step: stepNo, turn }, async () => ({ kind: 'enter', messages: [] }))
const injected = (decision) =>
  (decision?.messages || []).filter((m) => m?.source?.kind === 'plugin:persona-panel')

await api(null)
await api({ op: 'settings', settings: { level: 'auto' } })
open('home-s1')

// Quiet for the first five turns, one nudge on the sixth.
const quiet = []
for (let turn = 1; turn <= 5; turn += 1) quiet.push((await step('home-s1', turn)).messages.length)
ok('stays quiet for five turns', quiet.every((n) => n === 0), JSON.stringify(quiet))
const sixth = await step('home-s1', 6)
ok('nudges on the sixth turn', injected(sixth).length === 1)
ok('the message is marked as a plugin notice', injected(sixth)[0]?.source?.form === 'notice')
ok('the message has text', /记住|留下|记一条/.test(injected(sixth)[0]?.content?.[0]?.text || ''))
ok('the message asks instead of ordering', /？/.test(injected(sixth)[0]?.content?.[0]?.text || ''))

// Only the first step of a turn: step 2 must never carry it.
const secondStep = await step('home-s1', 7, 2)
ok('never injects on a later step', secondStep.messages.length === 0)

// A write resets the counter, and the session total stops at two.
await tools.get('persona_remember').execute({ kind: 'user', text: '他睡得晚' }, { agent: { id: 'home-s1' } })
const afterWrite = []
for (let turn = 7; turn <= 11; turn += 1) afterWrite.push((await step('home-s1', turn)).messages.length)
ok('a write clears the counter', afterWrite.every((n) => n === 0), JSON.stringify(afterWrite))
const again = await step('home-s1', 12)
ok('nudges again after another six turns', injected(again).length === 1)
const afterCap = []
for (let turn = 13; turn <= 24; turn += 1) afterCap.push((await step('home-s1', turn)).messages.length)
ok('one last nudge, then silence: three per session', afterCap.filter((n) => n === 1).length === 1 && afterCap.indexOf(1) === 5, JSON.stringify(afterCap))

// Switched off: a fresh session stays silent even after many turns.
await api({ op: 'settings', settings: { nudge: { on: false } } })
open('home-s2')
const off = []
for (let turn = 1; turn <= 10; turn += 1) off.push((await step('home-s2', turn)).messages.length)
ok('off means silent', off.every((n) => n === 0), JSON.stringify(off))

const failed = results.filter(([, pass]) => !pass)
console.log(`\nnudge: ${results.length - failed.length}/${results.length}`)
if (failed.length) process.exit(1)

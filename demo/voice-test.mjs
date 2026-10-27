// Two guards that keep a trait something I inhabit rather than something I obey:
// a rule-shaped self text is refused once, and the nudge asks a question instead
// of handing out a checklist.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-voice-'))

const { apply } = await import('../index.js')

let handler = null
const tools = {}
const hooks = []
const fakeCtx = {
  get: () => undefined,
  tools: { register: (def) => { tools[def.name] = def } },
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
  on: (name, fn) => { hooks.push([name, fn]); return () => {} },
}
apply(fakeCtx, {})

const dir = 'C:\\tmp\\voice-a'
const exec = { agent: { id: 'sess-voice', session: { header: { cwd: dir } } } }
const results = []
const ok = (name, cond, extra) => { results.push([name, !!cond, extra]); if (!cond) console.log('FAIL', name, extra ?? '') }

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
  const payload = body ? { ...body, dir } : null
  const headers = {}
  if (payload) {
    headers.host = '127.0.0.1:1234'
    headers.origin = 'http://127.0.0.1:1234'
    headers['sec-fetch-site'] = 'same-origin'
    headers['x-persona-token'] = token
  }
  const res = fakeRes()
  await handler(fakeReq(payload, headers, payload ? '/persona-panel/api' : `/persona-panel/api?dir=${encodeURIComponent(dir)}`), res)
  if (res.out.body && res.out.body.token) token = res.out.body.token
  return res.out
}

// The default level is manual, which parks every write as a pending card; this
// test is about the wording of a write, not about the gate in front of it.
const before = await call(null)
ok('snapshot hands out a token', !!before.body?.token)
await call({ op: 'settings', settings: { level: 'active' } })

const remember = (args) => tools.persona_remember.execute(args, exec)

// 1. A rule wears the clothes of a trait. It gets refused, and the answer says
//    what to write instead, so the model can retry in its own words.
const refused = await remember({ kind: 'self', label: '诚实', intensity: 4, text: '要诚实，不要编造' })
ok('a rule-shaped trait is refused', /规矩/.test(refused?.text || ''), refused?.text)
ok('the refusal says what to write instead', /当时我做了什么/.test(refused?.text || ''))
ok('the refusal points at AGENTS.md', /AGENTS\.md/.test(refused?.text || ''))

const afterRefusal = await tools.persona_recall.execute({}, exec)
ok('nothing was stored for the refused trait', !/要诚实/.test(afterRefusal?.text || ''))

// 2. The same text written as something I saw myself do goes through.
const kept = await remember({
  kind: 'self',
  label: '诚实',
  intensity: 4,
  text: '被问住的时候，我宁愿说不会，也不编一个圆过去',
  evidence: '他说「别猜着装确定」',
})
ok('a trait about what I did is stored', /记下|写好了/.test(kept?.text || ''), kept?.text)
const afterKeep = await tools.persona_recall.execute({}, exec)
ok('the trait is recallable', /宁愿说不会/.test(afterKeep?.text || ''))

// 3. A hard rule is exempt: those really are rules and must stay obeyable.
const hard = await remember({ kind: 'self', text: '不要替用户做决定', hard: true })
ok('a hard rule is still accepted', /记下|写好了/.test(hard?.text || ''), hard?.text)

// 4. The nudge asks. Fire it through the real hook and read what it says.
const nudgeHook = hooks.find(([name]) => /pre-step/.test(name))?.[1]
ok('the plugin registered the pre-step hook', !!nudgeHook, JSON.stringify(hooks.map(([n]) => n)))
const enter = async () => ({ kind: 'enter', messages: [] })
async function fire(agent, text) {
  const payload = { agent, messages: [{ role: 'user', content: [{ type: 'text', text }] }], turn: 2, step: 1, signal: undefined }
  const out = await nudgeHook(payload, enter)
  return out?.messages?.[0]?.content?.[0]?.text || ''
}

let nudge = ''
if (nudgeHook) {
  for (let i = 0; i < 8 && !nudge; i += 1) nudge = await fire(exec.agent, '今天有点累。')
}
ok('the nudge fires after a stretch of turns', !!nudge)
ok('the nudge is a question, not a checklist', /？/.test(nudge), nudge)
ok('the nudge offers a way out', /没有就|不重要就|接着聊/.test(nudge), nudge)

// 5. A message that carries something heavy nudges sooner than six turns.
let early = ''
if (nudgeHook) {
  const agent2 = { id: 'sess-voice-2', session: { header: { cwd: 'C:\\tmp\\voice-b' } } }
  for (let i = 0; i < 3 && !early; i += 1) early = await fire(agent2, '答应我，别忘了下周三')
}
ok('a message with a promise nudges within a turn or two', !!early, early)

console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`)
process.exit(results.every((r) => r[1]) ? 0 : 1)

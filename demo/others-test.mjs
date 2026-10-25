// Exercises the multi-user branch: off by default, refuses to record while off,
// records per person when on, folds out of the prompt when switched back off.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-others-'))

const { apply } = await import('../index.js')

let handler = null
let section = null
const tools = {}
const fakeCtx = {
  get: () => undefined,
  tools: { register: (def) => { tools[def.name] = def } },
  systemPrompt: { section: (opts) => { section = opts } },
  effect: (fn) => fn(),
  inject: (names, fn) => {
    fn({ webServer: { register: (opts) => { handler = opts.handler } } })
  },
}

apply(fakeCtx, {})

function fakeReq(method, body, headers) {
  const buf = Buffer.from(body ? JSON.stringify(body) : '')
  return {
    method,
    url: '/persona-panel/api',
    headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      if (buf.length) yield buf
    },
  }
}

function fakeRes() {
  const out = { status: 0, body: null }
  return {
    writeHead(status) { out.status = status; return this },
    end(payload) { out.raw = payload; try { out.body = payload ? JSON.parse(payload) : null } catch { out.body = null } },
    out,
  }
}

const dir = 'C:\\tmp\\group-ws'
async function call(method, body, headers) {
  const res = fakeRes()
  await handler(fakeReq(method, body, headers), res)
  return res.out
}

const first = await call('GET', null, {})
const token = first.body.token
const auth = { 'x-persona-token': token, origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin' }
const post = (body) => call('POST', { dir, ...body }, auth)

const say = (label, value) => console.log(`${label}: ${value}`)

say('others off by default', first.body.settings.features.others.on === false)

const added = await post({ op: 'addOther', name: '小缘', alias: '缘缘' })
say('addOther', `${added.status} ${JSON.stringify(added.body).slice(0, 200)}`)
await post({ op: 'settings', settings: { level: 'active' } })

const exec = { agent: { session: { header: { cwd: dir } } } }
const remember = tools.persona_remember

const refused = await remember.execute({ kind: 'user', text: '喜欢在群里发猫图', who: '小缘' }, exec)
say('record while off', refused.text.includes('关') ? 'refused' : `UNEXPECTED: ${refused.text}`)

await post({ op: 'settings', settings: { feature: { key: 'others', on: true, rec: true } } })
const wrote = await remember.execute({ kind: 'user', text: '喜欢在群里发猫图', who: '小缘' }, exec)
say('record while on', wrote.text)

const snap = await call('GET', null, {})
const person = (snap.body.store.others || [])[0]
say('stored under person', `${person.name}=${person.user.map((u) => u.text).join('/')}`)

const textOn = String(section.text({ agent: exec.agent }))
say('prompt has others section', textOn.includes('同一屋檐下的其他人') && textOn.includes('小缘'))

const event = await remember.execute({ kind: 'event', text: '约好下周一起打某个副本', date: '10-30', who: '小缘' }, exec)
say('event while on', event.text)

const afterEvent = await call('GET', null, {})
say('person impressions', afterEvent.body.store.others[0].user.map((u) => u.text).join('/'))

await post({ op: 'settings', settings: { feature: { key: 'others', on: false, rec: false } } })
const textOff = String(section.text({ agent: exec.agent }))
say('prompt folds them away', !textOff.includes('同一屋檐下的其他人'))

const backOff = await remember.execute({ kind: 'user', text: '不该写进去', who: '小缘' }, exec)
say('record when switched off again', backOff.text.includes('没写') ? 'refused' : `UNEXPECTED: ${backOff.text}`)

const victim = afterEvent.body.store.others[0].user[0]
say('victim id', `${JSON.stringify(victim)}`)
const gone = await post({ op: 'delOtherEntry', otherId: afterEvent.body.store.others[0].id, bucket: 'user', id: victim.id })
say('after delete ids', JSON.stringify((gone.body.store.others || []).map((o) => ({ id: o.id, u: (o.user || []).map((x) => `${x.id}:${x.text}`) }))))
say('main user', JSON.stringify((gone.body.store.user || []).map((x) => `${x.id}:${x.text}`)))
say('delete one impression -> left', (gone.body.store.others[0].user || []).length)

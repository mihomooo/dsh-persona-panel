// Diary: first-person, append-only. It reports itself, so the record gate does
// not apply to it -- but nothing may edit or delete a diary line afterwards.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-diary-'))

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

const dir = 'C:\\tmp\\diary-ws'
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

let s = await snap()
ok('diary on by default', s.settings.features.diary.on === true)
ok('diary records by default', s.settings.features.diary.rec === true)

// Manual level stops it from remembering *about* the user, not from speaking.
await post({ op: 'settings', settings: { level: 'manual' } })
const wrote = await remember({ kind: 'diary', text: '今天他把事情做完了，我在旁边看着，也跟着松了一口气。' })
s = await snap()
ok('diary ignores recorder level', s.store.diary.length === 1)
ok('diary stored without approval', /写下/.test(wrote.text))
const id = s.store.diary[0].id

const long = await remember({ kind: 'diary', text: '字'.repeat(700) })
s = await snap()
ok('diary truncates at 500', s.store.diary[0].text.length === 500 && /写下/.test(long.text))

const del = await post({ op: 'delEntry', id })
s = await snap()
ok('diary cannot be deleted', s.store.diary.length === 2)
ok('delete refusal explains why', /删不了/.test(del.body.extra?.text || ''))

const upd = await post({ op: 'updateEntry', id, text: '改一句' })
s = await snap()
ok('diary cannot be edited', s.store.diary.find((d) => d.id === id).text.startsWith('今天他'))
ok('edit refusal explains why', /不能改/.test(upd.body.extra?.text || ''))

const forget = await tools.persona_forget.execute({ id }, exec)
s = await snap()
ok('forget tool refuses diary', /删不了|改不了/.test(forget.text) && s.store.diary.length === 2)

const text = section.text({ agent: exec.agent })
ok('prompt has diary block', text.includes('我写下的字'))
ok('prompt carries the line', text.includes('跟着松了一口气'))
ok('prompt marks it read-only', text.includes('只读'))

// One read per session: the second turn of the same conversation must not pay
// for the diary again, and recall is where it can be re-opened.
const again = section.text({ agent: exec.agent })
ok('diary read once per session', !again.includes('我写下的字'))

// Two conversations in one workspace: each gets its own read, and switching back
// must not count as opening a new one again.
const second = { agent: { id: 'session-2', session: { header: { cwd: dir } } } }
ok('another session reads it again', section.text({ agent: second.agent }).includes('我写下的字'))
ok('switching back does not re-read', !section.text({ agent: exec.agent }).includes('我写下的字'))
ok('a second visit to session-2 does not either', !section.text({ agent: second.agent }).includes('我写下的字'))

// "All of it", not the newest few: both entries have to be there.
const full = section.text({ agent: { id: 'session-3', session: { header: { cwd: dir } } } })
ok('diary is read in full', full.includes('跟着松了一口气') && full.includes('字'.repeat(40)) && !full.includes('…（其余略）'))

const recalled = (await tools.persona_recall.execute({}, exec)).text
ok('recall can still read the diary', recalled.includes('跟着松了一口气') && /只读/.test(recalled))

await post({ op: 'settings', settings: { feature: { key: 'diary', on: false } } })
const off = await snap()
const offText = section.text({ agent: exec.agent })
ok('diary tab switch hides block', !offText.includes('我写下的字'))
ok('switch did not erase entries', off.store.diary.length === 2)

const denied = await remember({ kind: 'diary', text: '关掉之后不该写进来' })
s = await snap()
ok('hiding the tab still keeps recording', denied.text === '写下了一条。' && s.store.diary.length === 3)

await post({ op: 'settings', settings: { feature: { key: 'diary', on: false, rec: false } } })
const denied2 = await remember({ kind: 'diary', text: '记录关掉之后不该写进来' })
s = await snap()
ok('record switch refuses', /关/.test(denied2.text) && s.store.diary.length === 3)

// Recency window: last three weeks first, older lines only while there is room.
await post({ op: 'settings', settings: { feature: { key: 'diary', on: true, rec: true } } })
const day = (offset) => {
  const d = new Date(Date.now() - offset * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
await remember({ kind: 'diary', text: '两个月前的一句旧话', date: day(60) })
const withOld = section.text({ agent: { id: 'session-4', session: { header: { cwd: dir } } } })
ok('older lines are read when the room allows', withOld.includes('两个月前的一句旧话'))

// And when the room does not allow: the recent window survives, the tail says
// how much was dropped and where to look.
for (let i = 0; i < 40; i += 1) await remember({ kind: 'diary', text: `第${i}条：`.padEnd(90, '字') })
const big = section.text({ agent: { id: 'session-5', session: { header: { cwd: dir } } } })
ok('long diary is trimmed, not dumped', big.includes('只从最近往前放了') && big.length <= 2400)
ok('the window is still the recent side', big.includes('第39条') && !big.includes('两个月前的一句旧话'))

// Recall, on the other hand, starts from the earliest — that is the direction to
// walk when something has been forgotten.
const oldest = (await tools.persona_recall.execute({}, exec)).text
ok('recall lists the diary from the earliest', oldest.indexOf('两个月前的一句旧话') < oldest.indexOf('跟着松了一口气') && oldest.indexOf('两个月前的一句旧话') < oldest.indexOf('第39条'))

// The first meeting has to ask about the diary too. It records from the very
// first conversation and can never be edited or deleted afterwards, so a diary
// nobody was asked about is opt-out-by-accident.
await post({ op: 'firstRun', settings: { features: ['self', 'user', 'event'] } })
s = await snap()
ok('first run can leave the diary off', s.settings.features.diary.on === false)
await post({ op: 'firstRun', settings: { features: ['self', 'user', 'event', 'diary'] } })
s = await snap()
ok('first run keeps it on when checked', s.settings.features.diary.on === true)

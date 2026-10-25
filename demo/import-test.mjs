// "导入会话记录" used to hand the model a thin slice: 6 sessions, 120k chars,
// 1200 chars per turn — and the model was told to "拆材料", which reads as
// "summarise this chat". This pins the new contract: read the whole history,
// then recall yourself.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

const home = mkdtempSync(join(tmpdir(), 'pp-import-'))
process.env.DSH_HOME = home

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

const results = []
const ok = (name, cond, extra) => {
  results.push([name, !!cond])
  if (!cond) console.log('FAIL', name, extra === undefined ? '' : extra)
}

// Same key the host derives from a workspace path.
function sessionKeyFor(dir) {
  let key = '--'
  for (const ch of dir) {
    const code = ch.codePointAt(0)
    if (ch === '\\') key += '-'
    else if (ch === ':') continue
    else if (code > 127) key += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    else key += ch
  }
  return `${key}--`
}

const dir = 'C:\\tmp\\import-ws'
const root = join(home, 'sessions', sessionKeyFor(dir))

function writeSession(name, count, long) {
  const sessionDir = join(root, name)
  mkdirSync(sessionDir, { recursive: true })
  const lines = []
  for (let i = 0; i < count; i += 1) {
    const ev = {
      type: i % 2 === 0 ? 'user/message' : 'assistant/message',
      data: { content: [{ type: 'text', text: `${long ? 'A'.repeat(3000) : `第${i}句，说点什么好让这句话够长。`}` }] },
    }
    if (ev.type === 'assistant/message') ev.data.message = { content: ev.data.content }
    lines.push(JSON.stringify(ev))
  }
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8')))
  return lines.length
}

writeSession('session-early', 40, false)
writeSession('session-late', 30, true)

let token = null
async function snapshot() {
  const out = {}
  await handler(
    {
      method: 'GET',
      url: `/persona-panel/api?dir=${encodeURIComponent(dir)}`,
      headers: { host: '127.0.0.1:1234' },
      async *[Symbol.asyncIterator]() {},
    },
    { writeHead(s) { out.s = s }, end(p) { out.b = p ? JSON.parse(p) : null } },
  )
  if (out.b?.token) token = out.b.token
  return out.b
}
async function call(body) {
  const payload = { ...body, dir }
  const buf = Buffer.from(JSON.stringify(payload))
  const out = {}
  await handler(
    {
      method: 'POST',
      url: '/persona-panel/api',
      headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin', 'x-persona-token': token },
      async *[Symbol.asyncIterator]() { yield buf },
    },
    { writeHead(s) { out.s = s }, end(p) { out.b = p ? JSON.parse(p) : null } },
  )
  if (out.b?.token) token = out.b.token
  return out.b
}

const boot = await snapshot()
ok('panel answered the token handshake', !!token, boot?.error)
const r = await call({ op: 'importSessions' })
const x = r?.extra || {}
ok('import succeeded', r?.status === undefined ? !!r : true, r?.error)
ok('sessions counted across the whole history', x.sessions === 2, x.sessions)
ok('turns include both sessions', x.turns === 70, x.turns)
ok('no longer capped at 1200 chars per turn', x.chars > 30 * 2000, x.chars)

const file = x.path
ok('transcript written to disk', !!file && existsSync(file), file)
const text = file && existsSync(file) ? readFileSync(file, 'utf8') : ''
ok('header states how many sessions were covered', /本工作区共 2 个会话，这里收了最近的 2 个/.test(text), text.slice(0, 120))
ok('every session has a dated header', (text.match(/^## .*session-/gm) || []).length === 2)
ok('a long turn is clipped at 2000, not 1200', text.includes('A'.repeat(2000) + '…') && !text.includes('A'.repeat(2001)))

// The panel hands the model a file path; the prompt has to frame that file as
// "your own past", not "material to summarise".
const prompt = section.text({ agent: { id: 'sess-import', session: { header: { cwd: dir } } } })
ok('prompt names the transcript file', prompt.includes(file || '\u0000'), prompt.slice(-300))
ok('prompt asks me to recall myself, not summarise the chat', prompt.includes('回忆') && prompt.includes('别总结对话'))
ok('prompt warns the file may be long', prompt.includes('分段读'))

let failed = 0
for (const [name, good] of results) {
  if (!good) failed += 1
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${name}`)
}
console.log(`\n${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)

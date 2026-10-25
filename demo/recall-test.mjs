// 「回忆并写入」不再导出转写，也不再让宿主替它总结聊天：面板直接给这个工作区的
// 会话发一条指令，让模型拿自己上下文里的对话去回忆。
// 这里钉住三件事：指令真的送进了会话、四类都点名了、磁盘上不再落任何转写。
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'pp-recall-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

const dir = 'C:\\tmp\\recall-ws'
let handler = null
let section = null
let delivered = null
let followups = 0

const fakeCtx = {
  get: (name) => {
    if (name !== 'agents') return undefined
    return {
      list: () => [
        {
          session: { header: { cwd: dir } },
          followup: (message) => {
            followups += 1
            delivered = message
          },
        },
      ],
    }
  },
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
ok('the click is reported as a direct recall request', x.mode === 'recall', x.mode)
ok('the live session was woken', x.queued === true && followups === 1, JSON.stringify(x.kick))
ok('no transcript path is handed back any more', x.path === undefined && x.turns === undefined, JSON.stringify(Object.keys(x)))

const text = (delivered?.content || []).map((c) => c.text || '').join('\n')
ok('the message is delivered as a plugin notice', delivered?.source?.kind === 'plugin:persona-panel' && delivered?.source?.summary === '回忆并写入', JSON.stringify(delivered?.source))
ok('it asks for a memory, not a summary of the chat', text.includes('不要向我复述') && text.includes('不是摘要'), text.slice(0, 120))
ok('all four kinds are named', ['kind=self', 'hard=true', 'kind=user', 'kind=event'].every((k) => text.includes(k)), text.slice(0, 200))
ok('it says to look before writing', text.includes('persona_recall') && text.includes('不要重复写'), '')
ok('it forbids inventing a memory it does not have', text.includes('我手上没有这段记忆') && text.includes('不要编'), '')
ok('it does not mention files or transcripts', !/转写|transcript|\.md/.test(text), '')

ok('nothing was exported to disk', !existsSync(join(home, '.dsh', 'persona-panel', 'imports')), join(home, '.dsh', 'persona-panel', 'imports'))

const prompt = section.text({ agent: { id: 'sess-recall', session: { header: { cwd: dir } } } })
ok('prompt carries no leftover material block', !prompt.includes('等着你拆'), prompt.slice(-200))

// 没有开着的会话时必须说实话，而不是静默排队等下一次开口。
const lonely = { ...fakeCtx, get: () => undefined }
apply(lonely, {})
const r2 = await call({ op: 'importSessions' })
const x2 = r2?.extra || {}
ok('with no live session it says so instead of queueing', x2.queued === false && /没有|注册表/.test(String(x2.kick?.why)), JSON.stringify(x2.kick))

let failed = 0
for (const [name, good] of results) {
  if (!good) failed += 1
  console.log(`${good ? 'ok  ' : 'FAIL'}  ${name}`)
}
console.log(`\n${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)

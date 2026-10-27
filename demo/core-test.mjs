// 提示词最前面那块「此刻最像我」：最强的三条脾气、硬规矩、三条画像要出现在
// 开头，而且不能在下面完整列表里再出现一次（重复等于白花 token）。
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'pp-core-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

const dir = 'C:\\tmp\\core-ws'
let handler = null
let section = null
const tools = new Map()

const fakeCtx = {
  get: () => undefined,
  tools: { register: (tool) => { tools.set(tool.name, tool); return () => {} } },
  systemPrompt: { section: (opts) => { section = opts; return () => {} } },
  effect: (fn) => fn(),
  on: () => () => {},
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

await api(null)
await api({ op: 'settings', settings: { level: 'auto' } })
// Learn the session directory first: a tool call only carries the agent id, and
// the map from id to directory is filled while rendering the prompt.
section.text({ agent: { id: 'home-s1', session: { header: { cwd: dir } } } })

// Three traits of different strength, one hard rule, and three notes about him.
const remember = tools.get('persona_remember')
const call = (args) => remember.execute(args, { agent: { id: 'home-s1' } })
await call({ kind: 'self', label: '安静', intensity: 2, text: '不太抢话' })
await call({ kind: 'self', label: '傲娇', intensity: 5, text: '嘴上不承认' })
await call({ kind: 'self', label: '护短', intensity: 4, text: '见不得别人说她不好' })
await call({ kind: 'self', label: '话少', intensity: 1, text: '能一句说完就一句' })
// A note is `kind: 'self'` without a label — that is what makes it a rule.
await call({ kind: 'self', text: '不要叫我助手', hard: true })
await call({ kind: 'user', text: '他喜欢安静的房间' })
await call({ kind: 'user', text: '他睡得晚' })
await call({ kind: 'user', text: '他讨厌被催' })

const text = section.text({ agent: { id: 'home-s1', session: { header: { cwd: dir } } } })
ok('prompt has a core block', text.includes('### 此刻最像我'))
const coreStart = text.indexOf('### 此刻最像我')
const coreEnd = text.indexOf('### 这条线是记过的')
const core = text.slice(coreStart, coreEnd)
ok('core comes before the long sections', coreStart >= 0 && coreEnd > coreStart)
ok('core holds the strongest trait', core.includes('傲娇'))
ok('core holds the hard rule', core.includes('[硬] 不要叫我助手'))
ok('core holds a fact about him', core.includes('他喜欢安静的房间'))
ok('core stays short', core.length <= 480, core.length)
// Once in the core, never again below it: a repeated line is pure cost.
const below = text.slice(coreEnd)
ok('strong trait is not repeated below', !below.includes('傲娇'))
ok('core fact is not repeated below', !below.includes('他喜欢安静的房间'))
// The weakest trait stays in the full list — the core is a highlight, not a move.
ok('weakest trait stays in the full list', below.includes('话少'))

const failed = results.filter(([, ok2]) => !ok2)
console.log(`\ncore: ${results.length - failed.length}/${results.length}`)
if (failed.length) process.exit(1)

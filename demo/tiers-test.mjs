// What a session opens with, and how far back a recall reaches.
// Persona + impression whole; events by a share that shrinks as the drawer fills;
// diary = last 21 days (or newest 21 lines); recall walks backwards in quarters.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'pp-tiers-'))
process.env.DSH_HOME = home
const root = join(home, 'persona-panel')
mkdirSync(root, { recursive: true })

const dir = 'C:\\tmp\\tier-ws'
const ymd = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const N = 100
const diary = Array.from({ length: N }, (_, i) => ({
  id: `d${String(i + 1).padStart(3, '0')}`,
  at: new Date(Date.now() - (N - i) * 86400000).toISOString(),
  date: ymd(Date.now() - (N - i) * 86400000),
  text: `第${i + 1}天：今天这一条写得长一点，用来验证目录会把预览截断掉`,
}))
const events = Array.from({ length: 30 }, (_, i) => ({
  id: `e${i + 1}`,
  kind: 'precious',
  text: `事件${i + 1}`,
  date: '',
  status: 'open',
  hist: [],
}))

writeFileSync(
  join(root, 'db.json'),
  JSON.stringify({
    version: 1,
    seq: 200,
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
      lexicon: [],
      eventsCap: 0,
      agentName: 'Harness',
      userCall: '',
    },
    workspaces: { [dir]: { storeId: 's1', title: 'tier-ws', lastSeen: Date.now() } },
    stores: {
      s1: {
        self: [{ id: 't1', kind: 'trait', label: '耐心', intensity: 3 }],
        user: [{ id: 'u1', text: '喜欢安静' }],
        event: events,
        diary,
        others: [],
      },
    },
    pendingImport: null,
    orphans: [],
  }),
)

const { apply } = await import('../index.js')
let section = null
const tools = {}
const fakeCtx = {
  get: () => undefined,
  tools: { register: (def) => { tools[def.name] = def } },
  systemPrompt: { section: (opts) => { section = opts } },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: () => {} } }) },
}
apply(fakeCtx, {})

let failed = 0
const ok = (label, value) => {
  if (!value) failed += 1
  console.log(`${label}: ${value}`)
}

const exec = { agent: { id: 'session-1', session: { header: { cwd: dir } } } }
const open = section.text({ agent: exec.agent })
ok('persona is whole', open.includes('耐心'))
ok('impression is whole', open.includes('喜欢安静'))
const shown = (open.match(/^- 事件\d+/gm) || []).length
ok('events open at 60% of 30', shown === 18)
const diaryLines = (open.match(/^- \d{4}-\d{2}-\d{2} 第\d+天/gm) || []).length
ok('diary opens with 21 lines', diaryLines === 21)
ok('diary opens from the recent side', open.includes('第100天') && !open.includes('第70天'))

const recall = async (args) => (await tools.persona_recall.execute(args, exec)).text
const diaryCount = (text) => (text.match(/^- \d{4}-\d{2}-\d{2} 第\d+天/gm) || []).length

const shallow = await recall({ depth: 'shallow' })
ok('shallow is a quarter', diaryCount(shallow) === 25)
ok('shallow is the newest quarter', shallow.includes('第100天') && !shallow.includes('第75天'))

const medium = await recall({ depth: 'medium' })
ok('medium is a quarter', diaryCount(medium) === 25)
ok('medium sits in the middle', medium.includes('第51天') && !medium.includes('第50天') && !medium.includes('第76天'))

const deep = await recall({ depth: 'deep' })
ok('deep is a quarter', diaryCount(deep) === 25)
ok('deep is the earlier quarter', deep.includes('第26天') && !deep.includes('第25天') && !deep.includes('第51天'))

const auto = await recall({})
ok('default medium when the diary is long', diaryCount(auto) === 25)
const full = await recall({ depth: 'all' })
ok('all is all', diaryCount(full) === 100)
ok('events stay whole in recall', (full.match(/^- 事件\d+/gm) || []).length === 30)

const index = await recall({ depth: 'index' })
const months = [...index.matchAll(/^- (\d{4}-\d{2})（(\d+) 条）/gm)]
ok('index groups by month', months.length >= 3 && months.length <= 5)
ok('index counts add up', months.reduce((n, m) => n + Number(m[2]), 0) === 100)
ok('index previews are clipped', index.includes('…') && months.length < 8)
ok('index is much shorter than all', index.length * 2 < full.length)

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)

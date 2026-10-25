// The persona must follow the session's own workspace, never the last one the
// user happened to look at. Regression: a ds session got 溟月's card injected
// because the prompt section fell back to db.lastDir.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'pp-dir-'))
process.env.DSH_HOME = home

const MINGYUE = 'C:\\Users\\me\\Desktop\\溟月'
const DS = 'C:\\Users\\me\\Desktop\\ds'

// Seed a db where 溟月 is heavy and lastDir points at her, so any fallback leaks.
mkdirSync(join(home, 'persona-panel'), { recursive: true })
const seed = {
  version: 3,
  seq: 40,
  firstRun: false,
  lastDir: MINGYUE,
  settings: { level: 'auto', features: {}, lexicon: [], agentName: 'DeepSeek Harness', userCall: '' },
  workspaces: {
    [MINGYUE]: { storeId: 's1', title: '溟月', lastSeen: 1 },
    [DS]: { storeId: 's2', title: 'ds', lastSeen: 2 },
  },
  stores: {
    s1: {
      self: Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, kind: 'trait', label: `脾气${i}`, intensity: 5, note: '', ev: [], hist: [] })),
      user: [],
      event: [],
      pending: [],
      others: [],
    },
    s2: { self: [], user: [], event: [], pending: [], others: [] },
  },
  orphans: [],
}
writeFileSync(join(home, 'persona-panel', 'db.json'), JSON.stringify(seed), 'utf8')

const { apply } = await import('../index.js')

let section = null
const fakeCtx = {
  get: () => undefined,
  tools: { register: () => {} },
  systemPrompt: {
    section: (opts) => {
      section = opts
      return () => {}
    },
  },
  effect: (fn) => fn(),
  inject: () => {},
}

let failures = 0
function say(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` → ${detail}` : ''}`)
}

apply(fakeCtx, {})
say('section registered', !!section)

const agentFor = (id, cwd) => ({ id, session: { header: { cwd } } })

// 1. A ds turn must render ds (empty), not 溟月.
const dsText = String(section.text({ agent: agentFor('a-ds', DS), scope: {}, signal: {} }))
say('ds session renders the ds frame', dsText.includes('「ds」') && dsText.includes('这一节还是空的'), JSON.stringify(dsText.slice(0, 60)))
say('ds session never sees 溟月', !dsText.includes('溟月') && !dsText.includes('脾气0') && !dsText.includes('脾气14'))

// 2. A 溟月 turn gets her card.
const myText = String(section.text({ agent: agentFor('a-my', MINGYUE), scope: {}, signal: {} }))
say('溟月 session gets her card', myText.includes('脾气') && myText.includes('溟月'), `${myText.length} chars`)

// 3. No agent at all: inject nothing rather than guessing a workspace.
const blind = String(section.text({ scope: {}, signal: {} }))
say('unknown session injects nothing', blind === '', JSON.stringify(blind.slice(0, 60)))

// 4. lastDir must not be rewritten by a turn's own render.
const after = JSON.parse(await (await import('node:fs')).readFileSync(join(home, 'persona-panel', 'db.json'), 'utf8'))
say('lastDir follows the session', after.lastDir === MINGYUE, after.lastDir)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exitCode = failures ? 1 : 0

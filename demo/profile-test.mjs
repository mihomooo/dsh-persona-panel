// 人格档案：一份档案是整份 store + 设置的副本，能脱离工作区活着；
// 覆盖一个不空的工作区要先问，问过之后旧的那份变成「已归档」档案；
// 已归档的档案只能用一次，用过就变回普通档案。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'pp-profile-'))
process.env.DSH_HOME = root
mkdirSync(join(root, 'persona-panel'), { recursive: true })

const dirA = 'C:\\tmp\\p-a'
const dirB = 'C:\\tmp\\p-b'
const dirC = 'C:\\tmp\\p-c'
const features = {
  self: { on: true, rec: true },
  user: { on: true, rec: true },
  event: { on: true, rec: true },
  diary: { on: true, rec: true },
  others: { on: false, rec: false },
}
const settingsFor = (name, call) => ({ level: 'auto', agentName: name, userCall: call, lexicon: ['耐心'], eventsCap: 20, features })

const seed = {
  version: 1,
  seq: 60,
  firstRun: true,
  lastDir: dirA,
  settings: settingsFor('A酱', '老大'),
  workspaces: {
    [dirA]: { storeId: 's1', title: 'p-a', lastSeen: 300, settings: settingsFor('A酱', '老大') },
    [dirB]: { storeId: 's2', title: 'p-b', lastSeen: 200, settings: settingsFor('B酱', '老板') },
    [dirC]: { storeId: 's3', title: 'p-c', lastSeen: 100, settings: settingsFor('C酱', '你') },
  },
  stores: {
    s1: {
      self: [{ id: 't1', kind: 'trait', label: '耐心', intensity: 3, note: '', hist: [] }],
      user: [{ id: 'u1', text: '他喜欢直说', at: '10-20' }],
      event: [{ id: 'e1', kind: 'promise', text: '周一看电影', date: '10-28', hist: [] }],
      diary: [{ id: 'd1', text: '今天写了点东西', date: '2026-10-20' }],
      pending: [],
      others: [],
      cap: 20,
    },
    s2: {
      self: [{ id: 't2', kind: 'trait', label: '安静', intensity: 2 }],
      user: [],
      event: [],
      diary: [],
      pending: [],
      others: [],
      cap: 20,
    },
    // Only a diary: still not "nothing" — a replace here would eat a written day.
    s3: { self: [], user: [], event: [], diary: [{ id: 'd3', text: '只有日记', date: '2026-10-21' }], pending: [], others: [], cap: 20 },
  },
  sessions: {},
  pendingImport: null,
  orphans: [],
  profiles: [],
}
writeFileSync(join(root, 'persona-panel', 'db.json'), JSON.stringify(seed))

const { apply } = await import('../index.js')

let handler = null
const fakeCtx = {
  get: () => undefined,
  tools: { register: () => {} },
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
  inject: (names, fn) => { fn({ webServer: { register: (o) => { handler = o.handler } } }) },
}
apply(fakeCtx, {})

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
async function call(dir, body) {
  const payload = body ? { ...body, dir } : null
  const h = {}
  if (payload) { h.host = '127.0.0.1:1234'; h.origin = 'http://127.0.0.1:1234'; h['sec-fetch-site'] = 'same-origin'; h['x-persona-token'] = token }
  const res = fakeRes()
  await handler(fakeReq(payload, h, payload ? '/persona-panel/api' : `/persona-panel/api?dir=${encodeURIComponent(dir)}`), res)
  if (res.out.body && res.out.body.token) token = res.out.body.token
  return res.out.body
}
const snap = (dir) => call(dir, null)

const results = []
const ok = (name, cond, extra) => { results.push([name, !!cond]); if (!cond) console.log('FAIL', name, extra ?? '') }
const byId = (list, id) => list.find((p) => p.id === id)

let s = await snap(dirA)
ok('live workspaces show up as profiles', s.profiles.filter((p) => p.kind === 'live').length === 3, s.profiles.length)
ok('profiles are ordered by activity', s.profiles[0].name === 'p-a' && s.profiles[2].name === 'p-c', s.profiles.map((p) => p.name).join(','))
const cardA = s.profiles.find((p) => p.kind === 'live' && p.name === 'p-a')
ok('a live card counts every drawer', cardA.counts.self === 1 && cardA.counts.user === 1 && cardA.counts.event === 1 && cardA.counts.diary === 1, JSON.stringify(cardA.counts))
ok('a live card names where it came from', cardA.src.includes('p-a'), cardA.src)

// Replace a workspace that has something in it: ask first, change nothing yet.
let r = await call(dirB, { op: 'applyProfile', id: cardA.id })
ok('replacing a non-empty workspace asks first', r.extra?.needsArchive === true, JSON.stringify(r).slice(0, 160))
ok('asking changes nothing', (await snap(dirB)).store.self[0].label === '安静')

// Diary-only is still not empty.
const cardA2 = (await snap(dirC)).profiles.find((p) => p.kind === 'live' && p.name === 'p-a')
r = await call(dirC, { op: 'applyProfile', id: cardA2.id })
ok('a diary-only workspace still counts as occupied', r.extra?.needsArchive === true, JSON.stringify(r).slice(0, 160))

// Answer "archive it", then replace.
r = await call(dirB, { op: 'applyProfile', id: cardA.id, archive: 'yes' })
ok('replacing after the answer works', !r.extra?.error, JSON.stringify(r).slice(0, 160))
s = await snap(dirB)
ok('the incoming persona is now in place', s.store.self[0].label === '耐心' && s.store.diary.length === 1, JSON.stringify(s.store.self).slice(0, 120))
ok('settings travel with the copy', s.settings.agentName === 'A酱' && s.settings.userCall === '老大', s.settings.agentName)
const archivedB = s.profiles.find((p) => p.archived)
ok('the outgoing persona became an archived profile', !!archivedB && archivedB.name === 'p-b', JSON.stringify(s.profiles.map((p) => [p.name, p.kind])))
ok('the archived copy kept its entries', archivedB.counts.self === 1, JSON.stringify(archivedB.counts))

// An archived profile replaces exactly once, then it is an ordinary profile.
r = await call(dirB, { op: 'applyProfile', id: archivedB.id, archive: 'no' })
ok('an archived profile can replace without archiving again', !r.extra?.error, JSON.stringify(r).slice(0, 160))
s = await snap(dirB)
ok('used once, it leaves the archived list', !s.profiles.some((p) => p.id === archivedB.id), JSON.stringify(s.profiles.map((p) => [p.name, p.archived])))
const normal = s.profiles.find((p) => p.kind === 'copy' && p.name === 'p-b')
ok('it comes back as a normal profile', !!normal && normal.archived === false, JSON.stringify(s.profiles.map((p) => [p.name, p.kind, p.archived])))
ok('and the workspace got its old persona back', s.store.self[0].label === '安静', s.store.self[0]?.label)

// Export writes a file the user can find; import reads it back.
const liveB = s.profiles.find((p) => p.kind === 'live')
r = await call(dirB, { op: 'exportProfile', id: liveB.id })
const exportPath = r.extra?.path
ok('export writes a file', !!exportPath && existsSync(exportPath), JSON.stringify(r))
ok('export lands on the desktop', String(exportPath).includes('Desktop'), String(exportPath))
const payload = JSON.parse(readFileSync(exportPath, 'utf8'))
ok('the file is a persona profile', payload.kind === 'dsh-persona-profile' && payload.v === 1, payload.kind)
ok('the file carries the whole store', payload.store.self.length === 1 && !!payload.settings, JSON.stringify(Object.keys(payload)))
ok('the file is plain json on disk', dirname(exportPath).endsWith('Desktop'))

r = await call(dirB, { op: 'importProfile', text: JSON.stringify(payload), name: '导回来的' })
ok('import accepts its own export', !!r.extra?.id, JSON.stringify(r).slice(0, 160))
s = await snap(dirB)
const imported = byId(s.profiles, r.extra?.id)
ok('imported profile is listed', !!imported && imported.name === '导回来的', JSON.stringify(s.profiles.map((p) => p.name)))
ok('imported profile is not archived', imported.archived === false)

r = await call(dirB, { op: 'importProfile', text: '{}' })
ok('a file that is not a profile is rejected', r.extra?.error === '这不是人格档案文件', JSON.stringify(r))

r = await call(dirB, { op: 'purgeProfile', id: imported.id })
s = await snap(dirB)
ok('purge removes it for good', r.extra?.removed === 1 && !byId(s.profiles, imported.id), JSON.stringify(r))
ok('a live profile refuses to be purged', (await call(dirB, { op: 'purgeProfile', id: 'live:s2' })).extra?.error !== undefined)

// The panel shows one workspace at a time, so a replace names its target
// explicitly instead of using whatever happens to be open.
const cardA3 = (await snap(dirA)).profiles.find((p) => p.kind === 'live' && p.name === 'p-a')
r = await call(dirA, { op: 'applyProfile', id: cardA3.id, target: dirC })
ok('a replace can name another workspace', r.extra?.needsArchive === true && r.extra?.target === dirC, JSON.stringify(r.extra))

// Sharing strands the target's store without destroying it by accident.
r = await call(dirB, { op: 'copyFrom', from: dirA, mode: 'share' })
ok('sharing asks before stranding a store', r.extra?.needsArchive === true, JSON.stringify(r.extra))
r = await call(dirB, { op: 'copyFrom', from: dirA, mode: 'copy' })
ok('a plain copy destroys nothing, so it does not ask', r.extra?.needsArchive === undefined, JSON.stringify(r.extra))

if (exportPath) unlinkSync(exportPath)

console.log(`${results.filter((x) => x[1]).length}/${results.length}`)
const failed = results.filter((x) => !x[1]).length
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)

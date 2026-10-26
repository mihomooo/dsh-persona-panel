/**
 * dsh-persona-panel —host half.
 *
 * Three kinds of memory, kept per workspace:
 *   self   the persona I grew into here (traits + hard rules)
 *   user   my impression of the user (delete only, never edited)
 *   event  promises, moods, things worth keeping
 *
 * The panel (client half) reads and writes through a same-origin loopback
 * route; the agent reads/writes through tools and a prompt section.
 *
 * Node builtins only: a plugin ships without dependencies.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROUTE = '/persona-panel/api'
const PROMPT_BUDGET_CHARS = 2400
const STRENGTH = { 1: '一点', 2: '偏轻', 3: '中等', 4: '偏重', 5: '很重' }
// Minted once per host start. The panel reads it from its first GET and sends
// it back on every write; a request that never loaded the panel does not have
// it. Rotating on restart also invalidates anything a previous process learned.
const BOOT_TOKEN = randomBytes(16).toString('hex')

const DEFAULT_LEXICON = [
  '耐心', '温柔', '傲娇', '直接', '安静', '毒舌', '认真', '克制',
  '好奇', '护短', '急性子', '爱较真', '有条理', '话少', '稳', '爱逗你',
]

// ---------------------------------------------------------------- storage

function homeDir() {
  const env = process.env.DSH_HOME
  return env && env.trim() ? env.trim() : join(homedir(), '.dsh')
}
function dataRoot() {
  return join(homeDir(), 'persona-panel')
}
function emptyDb() {
  return {
    version: 1,
    seq: 0,
    firstRun: false,
    lastDir: '',
    settings: {
      // Start conservative: a new user should see one question, not a surprise
      // memory written on their behalf.
      level: 'manual',
      features: {
        self: { on: true, rec: true },
        user: { on: true, rec: true },
        event: { on: true, rec: true },
        // The agent's own diary: first-person notes it writes for itself. Not
        // about the user, never edited afterwards, and never counted as their data.
        diary: { on: true, rec: true },
        // Other people appearing in the same workspace (a QQ group bridged into
        // one session). Off by default: one workspace usually has one user.
        others: { on: false, rec: false },
      },
      lexicon: [...DEFAULT_LEXICON],
      // 0 means "no ceiling". Everything else counts event entries.
      eventsCap: 20,
      agentName: 'DeepSeek Harness',
      userCall: '',
    },
    workspaces: {},
    stores: {},
    // Which sessions have already opened here. The diary is read on the first
    // turn of each session and never again, so this only has to remember ids.
    sessions: {},
    // A pasted card or a file found on disk that is waiting for the model (not
    // the panel) to split it into entries. Session history no longer goes
    // through here: that job is a direct request, not a file.
    pendingImport: null,
    orphans: [],
    // Copies that no longer belong to a live workspace: imported files, and
    // archived ones that have already been used once to replace something.
    profiles: [],
  }
}

let dbCache = null
let dbRoot = ''

// The id list only feeds "has this session opened yet", so it can be trimmed
// without losing anything the user can see.
const MAX_SEEN_SESSIONS = 400
function pruneSessions(db) {
  const keys = Object.keys(db.sessions || {})
  if (keys.length <= MAX_SEEN_SESSIONS) return
  for (const k of keys.slice(0, keys.length - MAX_SEEN_SESSIONS)) delete db.sessions[k]
}

function loadDb() {
  const root = dataRoot()
  if (dbCache && dbRoot === root) return dbCache
  dbRoot = root
  const file = join(root, 'db.json')
  if (!existsSync(file)) {
    dbCache = emptyDb()
    return dbCache
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    dbCache = { ...emptyDb(), ...parsed, settings: { ...emptyDb().settings, ...(parsed.settings || {}) } }
    dbCache.settings.features = { ...emptyDb().settings.features, ...(parsed.settings?.features || {}) }
    if (!Array.isArray(dbCache.settings.lexicon) || !dbCache.settings.lexicon.length) {
      dbCache.settings.lexicon = [...DEFAULT_LEXICON]
    }
  } catch (error) {
    // A torn file must not take the plugin down: keep a copy, start clean.
    try {
      renameSync(file, `${file}.broken-${Date.now()}`)
    } catch {}
    console.error(`[persona-panel] db.json unreadable, starting fresh: ${error?.message ?? error}`)
    dbCache = emptyDb()
  }
  return dbCache
}

function saveDb(db) {
  const root = dataRoot()
  mkdirSync(root, { recursive: true })
  const file = join(root, 'db.json')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  renameSync(tmp, file)
}

function audit(db, entry) {
  try {
    const root = dataRoot()
    mkdirSync(root, { recursive: true })
    const file = join(root, 'audit.log')
    // Keep one generation: an append-only log on a machine that runs for weeks
    // should not grow without a ceiling.
    try {
      if (statSync(file).size > 2 * 1024 * 1024) renameSync(file, join(root, 'audit.log.1'))
    } catch {}
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8')
  } catch {}
}

// Tamper evidence, not tamper proof: the hashes live next to the files, so a
// process that can edit one can edit the other. What this catches is the case
// nobody notices otherwise — the plugin on disk changed since it last ran.
function fileHash(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

function checkIntegrity(db) {
  const here = dirname(fileURLToPath(import.meta.url))
  const current = {
    'index.js': fileHash(join(here, 'index.js')),
    'client.js': fileHash(join(here, 'client.js')),
  }
  const baseline = db.integrity && db.integrity.files
  if (!baseline) {
    db.integrity = { files: current, at: new Date().toISOString() }
    return true
  }
  const changed = Object.keys(current).filter((f) => current[f] && baseline[f] && current[f] !== baseline[f])
  if (changed.length) {
    db.integrityWarn = { at: new Date().toISOString(), files: changed }
    bootLog(new Error(`plugin files changed since last run: ${changed.join(', ')}`), 'integrity')
    return true
  }
  return false
}

// Activation must never block the app from booting: if something here fails we
// record why and keep the rest of the plugin best-effort.
function bootLog(error, where) {
  try {
    const root = dataRoot()
    mkdirSync(root, { recursive: true })
    const stack = error && error.stack ? error.stack : String(error)
    appendFileSync(join(root, 'boot.log'), `${new Date().toISOString()} [${where || 'apply'}] ${stack}\n\n`, 'utf8')
  } catch {}
  try {
    console.error(`[persona-panel] ${where || 'apply'} failed: ${error?.message ?? error}`)
  } catch {}
}

// ------------------------------------------------------------ workspaces

// Everything written here ends up inside the system prompt, so it is flattened on
// the way in: one line, no control characters, bounded length. A stored newline
// would let an entry start its own paragraph in the prompt and read like an
// instruction; collapsing it keeps memory as data.
function cleanText(value, max = 600) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function normalizeDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return ''
  try {
    return resolve(dir.trim())
  } catch {
    return dir.trim()
  }
}

function nextId(db, prefix) {
  db.seq = (db.seq || 0) + 1
  return `${prefix}${db.seq}`
}

function nextStoreId(db) {
  db.seq = (db.seq || 0) + 1
  return `s${db.seq}`
}

function ensureWorkspace(db, dir, title) {
  const key = normalizeDir(dir)
  if (!key) return null
  let ws = db.workspaces[key]
  if (!ws) {
    const storeId = nextStoreId(db)
    db.stores[storeId] = { self: [], user: [], event: [], pending: [], cap: db.settings?.eventsCap ?? 20 }
    ws = { storeId, title: title || basename(key) || key, lastSeen: Date.now() }
    db.workspaces[key] = ws
  }
  if (title) ws.title = title
  // `lastSeen` is NOT touched here. Every panel request (open the panel, click a
  // workspace, refresh) runs ensureWorkspace, and bumping the stamp on a read
  // made the list re-sort under the cursor: the row you just clicked jumped to
  // the top. Real activity — an agent turn in that workspace — bumps it instead,
  // from the prompt renderer and the write path.
  if (!db.stores[ws.storeId]) db.stores[ws.storeId] = { self: [], user: [], event: [], pending: [] }
  return ws
}

// Genuine activity: a turn is being answered here. Called from the prompt
// renderer, which only runs when that workspace's session is actually talking.
function touchSeen(db, dir) {
  const key = normalizeDir(dir)
  const ws = key ? db.workspaces[key] : null
  if (!ws) return false
  // Every turn is activity. No throttle: alternating between two workspaces
  // inside the same second is exactly the case the list must get right.
  const now = Date.now()
  if (now === ws.lastSeen) return false
  ws.lastSeen = now
  return true
}

// The Host owns the real Workspace list; adopt every workspace it knows about so
// the panel shows all of them, not just the one whose prompt happened to render.
let registryRef = null
// The root context, kept so a panel action (an HTTP request, outside any agent
// turn) can still reach the live agent registry and wake a session.
let rootCtx = null

// Workspace list sources, in order of trust:
//  1. the Host's workspace registry service (live, authoritative);
//  2. `~/.dsh/storages/workspace.json` — the Host's own persisted table. The
//     service handle is optional, and when it is missing (or its shape differs
//     from what we expect) this file still lists every workspace. Without this
//     fallback a newly created workspace stayed invisible until the user spoke
//     in it, which read as "the plugin lost my workspace".
function workspaceFileEntries() {
  try {
    const file = join(homeDir(), 'storages', 'workspace.json')
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const table = parsed?.tables?.workspaces
    if (!table || typeof table !== 'object') return []
    return Object.values(table)
      .filter((w) => w && typeof w.path === 'string')
      .map((w) => ({ path: w.path, title: typeof w.title === 'string' ? w.title : '' }))
  } catch {
    return []
  }
}

function syncRegistry(db) {
  const sources = []
  if (registryRef && typeof registryRef.list === 'function') {
    try {
      const live = registryRef.list()
      if (Array.isArray(live) && live.length) sources.push(['service', live])
    } catch {}
  }
  sources.push(['file', workspaceFileEntries()])
  let changed = false
  for (const [source, list] of sources) {
    for (const w of list) {
      const dir = normalizeDir(w && w.path)
      if (!dir) continue
      const title = typeof w.title === 'string' && w.title.trim() ? w.title.trim() : ''
      const ws = db.workspaces[dir]
      if (!ws) {
        const storeId = nextStoreId(db)
        db.stores[storeId] = { self: [], user: [], event: [], diary: [], pending: [] }
        db.workspaces[dir] = { storeId, title: title || basename(dir) || dir, lastSeen: 0, from: source }
        changed = true
      } else if (title && ws.title !== title) {
        ws.title = title
        changed = true
      }
    }
  }
  return changed
}

// Settings are per workspace: the way I behave in a work folder is not the way I
// behave in a chat folder. `db.settings` is only the template for a new workspace.
function settingsOf(db, dir) {
  const key = normalizeDir(dir)
  const ws = key ? db.workspaces[key] : null
  if (!ws) return db.settings
  if (!ws.settings || typeof ws.settings !== 'object') {
    ws.settings = JSON.parse(JSON.stringify(db.settings))
  }
  // A workspace settings object can be partial: some ops write one key at a
  // time, and older databases never had the newer keys. A missing key falls
  // back to the template; an explicitly empty one (userCall: '') stays empty.
  for (const k of ['level', 'agentName', 'userCall']) {
    if (ws.settings[k] === undefined) ws.settings[k] = db.settings[k]
  }
  ws.settings.features = ws.settings.features || {}
  for (const k of ['self', 'user', 'event', 'diary']) {
    if (!ws.settings.features[k]) ws.settings.features[k] = { on: true, rec: true }
  }
  // Other people are opt-in per workspace: absent means off, not on.
  if (!ws.settings.features.others) ws.settings.features.others = { on: false, rec: false }
  if (!Array.isArray(ws.settings.lexicon)) ws.settings.lexicon = db.settings.lexicon || []
  ws.settings.eventsCap = capOf(db, key)
  const shared = db.stores[ws.storeId]
  if (shared && typeof shared.cap !== 'number') shared.cap = ws.settings.eventsCap
  return ws.settings
}

function storeOf(db, dir) {
  const key = normalizeDir(dir)
  const ws = key ? db.workspaces[key] : null
  if (!ws) return null
  return db.stores[ws.storeId] || null
}

// The event ceiling belongs to the data, not to the workspace label: two
// workspaces in symbiosis share one store, so they must share one ceiling.
// Without this, raising the cap on one side left the other rejecting writes.
function capOf(db, dir) {
  const ws = db.workspaces[normalizeDir(dir)]
  const store = ws ? db.stores[ws.storeId] : null
  if (store && typeof store.cap === 'number' && Number.isFinite(store.cap)) return store.cap
  // Older databases kept the ceiling per workspace, so two partners may disagree.
  // Take the loosest one: refusing writes the user already allowed is the worse
  // failure, and settingsOf() persists the choice on the store right after.
  let best = null
  if (ws) {
    for (const w of Object.values(db.workspaces)) {
      if (w.storeId !== ws.storeId) continue
      const v = w.settings?.eventsCap
      if (typeof v === 'number' && Number.isFinite(v) && (best === null || v > best)) best = v
    }
  }
  if (best !== null) return best
  return typeof db.settings.eventsCap === 'number' ? db.settings.eventsCap : 20
}

function setCap(db, dir, value) {
  const key = normalizeDir(dir)
  const ws = db.workspaces[key]
  const v = Math.max(0, Math.min(999, Math.floor(Number(value) || 0)))
  // The panel can be opened with no workspace in hand (the 记忆 entry in the
  // sidebar is global), and then the request carries dir="". Silently dropping
  // the number there looks like a save that never happened, so fall back to the
  // database default that every new store is born with.
  if (!ws) {
    db.settings.eventsCap = v
    return
  }
  const store = db.stores[ws.storeId]
  if (store) store.cap = v
  for (const w of Object.values(db.workspaces)) {
    if (w.storeId !== ws.storeId) continue
    w.settings = w.settings || {}
    w.settings.eventsCap = v
  }
}

// Everything that describes the shared data, not the workspace label. Two
// workspaces in symbiosis show the same name, the same three switches, the same
// word list and the same event ceiling — changing it on one side changes both.
const SHARED_SETTINGS = ['agentName', 'userCall', 'features', 'lexicon']

function copyShared(dst, src) {
  if (!src) return
  if (typeof src.agentName === 'string') dst.agentName = src.agentName
  if (typeof src.userCall === 'string') dst.userCall = src.userCall
  if (src.features) dst.features = JSON.parse(JSON.stringify(src.features))
  if (Array.isArray(src.lexicon)) dst.lexicon = src.lexicon.slice(0, 64)
}

function applySharedSettings(db, dir) {
  const key = normalizeDir(dir)
  const ws = db.workspaces[key]
  if (!ws || !ws.settings) return
  for (const w of Object.values(db.workspaces)) {
    if (w.storeId !== ws.storeId) continue
    if (w === ws) continue
    w.settings = w.settings || {}
    copyShared(w.settings, ws.settings)
    w.settings.eventsCap = capOf(db, key)
  }
  const store = db.stores[ws.storeId]
  if (store) store.cap = capOf(db, key)
}

// ------------------------------------------------------------ other people
// One store can carry the main user's impression plus branches for everybody
// else who talks in the same workspace. Branches are read only while the
// workspace has `features.others.on`; the data stays when it is switched off.

function othersOf(store) {
  if (!store) return []
  if (!Array.isArray(store.others)) store.others = []
  return store.others
}

function findOther(store, who) {
  const key = String(who || '').trim()
  if (!key) return null
  return othersOf(store).find((o) => o.name === key || (o.aliases || []).includes(key)) || null
}

// Module-level clock: the per-request `stamp` inside applyOps is out of scope
// for these helpers.
function stampNow() {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ensureOther(store, who) {
  const key = String(who || '').trim()
  if (!key) return null
  const found = findOther(store, key)
  if (found) {
    found.lastSeen = stampNow()
    return found
  }
  const entry = {
    id: `o${randomUUID().slice(0, 8)}`,
    name: key,
    aliases: [],
    user: [],
    event: [],
    lastSeen: stampNow(),
  }
  othersOf(store).unshift(entry)
  return entry
}

function sharedAs(db, storeId) {
  return Object.entries(db.workspaces)
    .filter(([, ws]) => ws.storeId === storeId)
    .map(([dir, ws]) => ({ dir, title: ws.title }))
}

// ------------------------------------------------------------- profiles

// A profile is a copy of a whole store plus the settings that shaped it, so a
// persona can outlive the workspace it grew up in. Live workspaces are already
// such a copy — they are listed from db.stores instead of being duplicated —
// while db.profiles holds imported or used-up copies and db.orphans holds the
// archived ones.
const PROFILE_SOURCES = 3

function storeCounts(store) {
  const others = store?.others || []
  return {
    self: (store?.self || []).length,
    user: (store?.user || []).length,
    event: (store?.event || []).length,
    diary: (store?.diary || []).length,
    others: others.reduce((n, o) => n + (o.user || []).length + (o.event || []).length, 0),
  }
}

function totalCount(counts) {
  return counts.self + counts.user + counts.event + counts.diary + counts.others
}

// "Empty" has to mean really empty. A workspace that only kept a diary, only
// group profiles, or only a queued write is still something a replace would
// destroy, so none of those count as nothing.
function storeIsEmpty(store) {
  if (!store) return true
  return totalCount(storeCounts(store)) === 0 && (store.pending || []).length === 0
}

function copyStore(store) {
  return JSON.parse(JSON.stringify({
    self: store?.self || [],
    user: store?.user || [],
    event: store?.event || [],
    diary: store?.diary || [],
    others: store?.others || [],
    pending: store?.pending || [],
  }))
}

function sourceText(sources) {
  const list = (sources || []).filter(Boolean)
  if (!list.length) return ''
  const names = list.slice(0, PROFILE_SOURCES).map((s) => s.title || basename(s.dir || '') || '未命名')
  const rest = list.length - names.length
  return `来自「${names.join('」「')}」${rest > 0 ? ` 等 ${list.length} 个` : ''}`
}

function profileCard(id, kind, name, sources, store, archived, at) {
  return {
    id,
    kind,
    name: name || '未命名',
    sources: (sources || []).filter((s) => s && (s.dir || s.title)),
    src: sourceText(sources),
    counts: storeCounts(store),
    total: totalCount(storeCounts(store)),
    archived: !!archived,
    at: at || '',
  }
}

function profileList(db) {
  const live = []
  for (const storeId of Object.keys(db.stores)) {
    const owners = sharedAs(db, storeId)
    if (!owners.length) continue
    // The most recently used workspace names the profile, the three newest name
    // its source line: a symbiote family is one persona, not three.
    const ranked = [...owners].sort((a, b) => (db.workspaces[b.dir]?.lastSeen || 0) - (db.workspaces[a.dir]?.lastSeen || 0))
    const last = Math.max(...ranked.map((o) => db.workspaces[o.dir]?.lastSeen || 0))
    live.push({ ...profileCard(`live:${storeId}`, 'live', ranked[0].title, ranked, db.stores[storeId], false, ''), lastSeen: last })
  }
  live.sort((a, b) => b.lastSeen - a.lastSeen)
  const copies = (db.profiles || []).map((p) => profileCard(p.id, 'copy', p.name, p.sources, p.store, false, p.at))
  const archived = (db.orphans || []).map((o) => profileCard(o.id, 'orphan', o.from, o.sources || [{ dir: o.dir || '', title: o.from }], o.snap, true, o.at))
  return [...live, ...copies, ...archived]
}

function profileData(db, id) {
  const key = String(id || '')
  if (key.startsWith('live:')) {
    const storeId = key.slice(5)
    const owners = sharedAs(db, storeId)
    if (!owners.length) return null
    const ranked = [...owners].sort((a, b) => (db.workspaces[b.dir]?.lastSeen || 0) - (db.workspaces[a.dir]?.lastSeen || 0))
    const ws = db.workspaces[ranked[0].dir]
    return {
      kind: 'live',
      name: ranked[0].title,
      sources: ranked,
      store: db.stores[storeId] || {},
      settings: ws?.settings || {},
      storeId,
    }
  }
  const copy = (db.profiles || []).find((p) => p.id === key)
  if (copy) return { kind: 'copy', name: copy.name, sources: copy.sources || [], store: copy.store || {}, settings: copy.settings || {} }
  const orphan = (db.orphans || []).find((o) => o.id === key)
  if (orphan) return { kind: 'orphan', name: orphan.from, sources: orphan.sources || [{ dir: orphan.dir || '', title: orphan.from }], store: orphan.snap || {}, settings: orphan.settings || {} }
  return null
}

function profileFileName(name) {
  const safe = String(name || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile'
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  return `dsh-persona-${safe}-${ts}.json`
}

function snapshot(db, dir) {
  const key = normalizeDir(dir)
  const ws = key ? db.workspaces[key] : null
  const store = ws ? db.stores[ws.storeId] || { self: [], user: [], event: [], diary: [], pending: [] } : { self: [], user: [], event: [], diary: [], pending: [] }
  const users = ws ? sharedAs(db, ws.storeId) : []
  return {
    dir: key,
    title: ws?.title || (key ? basename(key) : ''),
    storeId: ws?.storeId || '',
    sharedBy: users.filter((x) => x.dir !== key),
    sharedWith: users.length,
    store: {
      self: store.self || [],
      user: store.user || [],
      event: store.event || [],
      diary: store.diary || [],
      pending: store.pending || [],
      others: (store.others || []).map((o) => ({
        id: o.id,
        name: o.name,
        aliases: o.aliases || [],
        user: o.user || [],
        event: o.event || [],
        lastSeen: o.lastSeen || '',
      })),
    },
    settings: settingsOf(db, dir),
    firstRun: db.firstRun,
    workspaces: Object.entries(db.workspaces)
      .map(([d, w]) => ({
        dir: d,
        title: w.title,
        storeId: w.storeId,
        lastSeen: w.lastSeen || 0,
        sharedWith: sharedAs(db, w.storeId).length,
        counts: {
          self: (db.stores[w.storeId]?.self || []).length,
          user: (db.stores[w.storeId]?.user || []).length,
          event: (db.stores[w.storeId]?.event || []).length,
          diary: (db.stores[w.storeId]?.diary || []).length,
        },
      }))
      // Order is by real activity, then by name: two workspaces that never had a
      // turn both sit at 0, and without the tiebreak their relative order would
      // depend on insertion history rather than on anything the user can see.
      .sort((a, b) => b.lastSeen - a.lastSeen || String(a.title || a.dir).localeCompare(String(b.title || b.dir), 'zh')),
    orphans: db.orphans.map((o) => ({ id: o.id, from: o.from, type: o.type, n: o.n, at: o.at, dir: o.dir || '', storeId: o.storeId || '' })),
    profiles: profileList(db),
    pendingImport: db.pendingImport && db.pendingImport.dir === key ? db.pendingImport : null,
    integrityWarn: db.integrityWarn || null,
  }
}

// --------------------------------------------------------------- prompt

// Only what is about to come due earns a line in the standing prompt. Everything
// else waits in the drawers and is read with persona_recall when the agent feels
// it has forgotten something — a 20-event list every turn costs tokens and buries
// the persona under old news.
function parseDay(value) {
  const m = String(value || '').match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const now = new Date()
  const year = m[1] ? Number(m[1]) : now.getFullYear()
  const d = new Date(year, Number(m[2]) - 1, Number(m[3]))
  // A bare MM-DD that already passed this year means next year: a birthday is
  // not "over", it is coming round again.
  if (!m[1] && d.getTime() < now.getTime() - 86400000) d.setFullYear(year + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

function dueEvents(events, days = 3) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out = []
  for (const e of events || []) {
    if (!e || !e.date || e.status === 'done') continue
    const t = parseDay(e.date)
    if (!t) continue
    const diff = Math.round((t.getTime() - today.getTime()) / 86400000)
    if (diff <= days) out.push(e)
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 4)
}

// What a session opens with. Persona and impression are always whole; events and
// diary are windows, because they grow without bound and a session cannot start by
// paying for all of it.
//
// Diary: last three weeks, or the newest 21 lines if the last three weeks are
// thin — a quiet month should not open with an empty diary.
const DIARY_RECENT_DAYS = 21
const DIARY_START_ENTRIES = 21
function diaryStartup(entries) {
  const now = Date.now()
  const rows = (entries || []).map((d, i) => ({ d, t: parseDay(d.date)?.getTime() ?? null, i }))
  rows.sort((a, b) => (b.t ?? 0) - (a.t ?? 0) || a.i - b.i)
  const recent = rows.filter((r) => r.t !== null && now - r.t <= DIARY_RECENT_DAYS * 86400000)
  const picked = recent.length >= DIARY_START_ENTRIES ? recent.slice(0, DIARY_START_ENTRIES) : rows.slice(0, DIARY_START_ENTRIES)
  return { picked: picked.map((r) => r.d), total: rows.length }
}

// Events: the fuller the drawer, the smaller the share a session start reads —
// 100% up to 8, 80% up to 20, 60% beyond. Starred first, then newest.
function eventWindow(events) {
  const n = (events || []).length
  const share = n <= 8 ? 1 : n <= 20 ? 0.8 : 0.6
  const take = Math.max(1, Math.ceil(n * share))
  const starred = events.filter((e) => e.important)
  const rest = events.filter((e) => !e.important)
  return { picked: [...starred, ...rest].slice(0, take), total: n, take }
}

// Recall depth, applied to the diary only: shallow is the newest quarter, medium
// the third quarter, deep the second one — a walk backwards through a long life.
function diarySlice(list, depth) {
  const n = list.length
  if (!n) return []
  if (depth === 'all' || (!depth && n <= 60)) return list
  const take = Math.ceil(n * 0.25)
  const start = depth === 'shallow' ? Math.ceil(n * 0.75) : depth === 'deep' ? Math.ceil(n * 0.25) : Math.ceil(n * 0.5)
  return list.slice(start, start + take)
}

// Trim a prepared diary block to what the rest of the section leaves behind.
function fitDiary(entries, budget) {
  const lines = []
  let used = 0
  for (const d of entries) {
    const line = `- ${d.date ? `${d.date} ` : ''}${d.text}`
    if (used + line.length + 1 > budget) break
    lines.push(line)
    used += line.length + 1
  }
  return { lines, truncated: lines.length < entries.length }
}

function renderPrompt(db, dir, opts = {}) {
  const store = storeOf(db, dir)
  if (!store) return ''
  const { features, agentName, userCall, level } = settingsOf(db, dir)
  const parts = []
  if (features.self?.on && store.self.length) {
    const traits = store.self.filter((e) => e.kind !== 'note').sort((a, b) => (b.intensity || 0) - (a.intensity || 0))
    const notes = store.self.filter((e) => e.kind === 'note').sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0))
    const lines = []
    // Hard rules go before everything else — they exist to survive being skimmed,
    // so they must not sit after a pile of traits.
    for (const n of notes.filter((x) => x.hard)) lines.push(`[硬] ${n.text}`)
    // No "4/5" here: a number reads like a rating sheet, gets quoted back as
    // "5/5 傲娇", and invites the model to argue with the rating instead of
    // just having the tendency.
    if (traits.length) lines.push(traits.map((t) => `${t.label}${t.intensity ? `（${STRENGTH[t.intensity] || '明显'}）` : ''}${t.note ? `（${t.note}）` : ''}`).join('、'))
    for (const n of notes.filter((x) => !x.hard)) lines.push(n.text)
    parts.push(`### 我在这里的样子\n${lines.join('\n')}`)
  }
  if (features.user?.on && store.user.length) {
    parts.push(`### 我眼里的${userCall ? `「${userCall}」` : '你'}\n${store.user.map((u) => `- ${u.text}`).join('\n')}`)
  }
  if (features.event?.on && store.event.length) {
    // A session opens with a share of the event drawer (all of it while small),
    // and later turns carry only what is about to come due.
    if (opts.freshSession) {
      const win = eventWindow(store.event)
      const lines = win.picked.map((e) => `- ${e.important ? '★ ' : ''}${e.text}${e.date ? ` · ${e.date}` : ''}`)
      const tail = win.take < win.total ? `（共 ${win.total} 条，这一节先放 ${win.take} 条；其余的忘了再查。）` : ''
      parts.push(`### 我记着的事\n${lines.join('\n')}${tail ? `\n${tail}` : ''}`)
    } else {
      const soon = dueEvents(store.event)
      if (soon.length) {
        parts.push(
          `### 快到日子的事\n${soon.map((e) => `- ${e.date} ${e.text}`).join('\n')}\n到了就提一句，别等用户自己想起来。`,
        )
      }
    }
  }
  // Other people stay out of the prompt entirely while the feature is off: the
  // data is kept, but the model must not reason about it.
  if (features.others?.on && (store.others || []).length) {
    const rows = []
    for (const o of store.others.slice(0, 12)) {
      const bits = []
      if ((o.user || []).length) bits.push(o.user.slice(0, 3).map((u) => u.text).join('；'))
      if ((o.event || []).length) bits.push(o.event.slice(0, 3).map((e) => `${e.text}${e.date ? `（${e.date}）` : ''}`).join('；'))
      if (bits.length) rows.push(`- ${o.name}：${bits.join(' / ')}`)
    }
    if (rows.length) {
      parts.push(`### 同一屋檐下的其他人\n${rows.join('\n')}\n这些是别人的事，不是${userCall ? `「${userCall}」` : '你'}的；提到时带上名字。`)
    }
  }
  // "Empty" means no entries of any kind — a workspace whose only content is a
  // diary (or events) must not be told it is empty just because this turn does
  // not happen to read those drawers.
  const hasEntries = !!(
    (store.self || []).length ||
    (store.user || []).length ||
    (store.event || []).length ||
    (store.diary || []).length ||
    (store.others || []).length
  )
  const willReadDiary = !!(opts.freshSession && features.diary?.on && (store.diary || []).length)
  // A pasted card waiting to be split into entries. Sessions are no longer
  // exported to a file, so this only ever describes source material. Computed
  // before the empty-store shortcut: importing a card is most common in a
  // workspace with nothing in it yet, and an early return used to swallow the
  // only instruction that told the model the file existed.
  const pending = db.pendingImport
  const waiting = pending && pending.dir === normalizeDir(dir) && pending.path ? pending : null
  const pendingText = waiting
    ? [
        '### 有一份材料等着你拆',
        `文件：${waiting.path}`,
        '这是别人给你的人设卡或设定稿，是素材，不是你的记忆。按下面拆：',
        '- 大类：反复出现的性格倾向，label 一两个词、intensity 1–5，text 写一句行为描述；同一特征只写一条；',
        '- 人格补充：明确的禁止/必须/称呼/口癖等不可改写的规矩，kind=self 并 hard=true，text 原文照抄。',
        '- 画像：关于用户本人的稳定事实（习惯、偏好、禁忌、处境），kind=user；不要把人物的性格塞进画像。',
        '- 事件：只有明确写过的时间和约定才写 kind=event，带 date；不确定的不写。',
        '文件可能很长：先用 read 分段读到结尾再动笔；这一轮读不完就先读，读完那一轮再写。',
        '落完后不要向用户复述这份文件，也不要提「导入」或「记忆」这件事。',
      ].join('\n')
    : ''
  const withPending = (text) => {
    const joined = pendingText ? `${text}\n\n${pendingText}` : text
    if (joined.length > PROMPT_BUDGET_CHARS) return `${joined.slice(0, PROMPT_BUDGET_CHARS)}\n…（其余略）`
    return joined
  }
  if (!hasEntries) {
    const bareName = basename(normalizeDir(dir) || '') || '这里'
    const hints = [
      `## 背景：${agentName} 在「${bareName}」`,
      '这一节还是空的。遇到值得留下的东西就直接记，不要在回复里说明你在记录，也不用先问。',
      '- 用 persona_remember：我的脾气 kind=self（label 一两个词 + intensity 1–5）、对你的印象 kind=user、约定和值得记住的时刻 kind=event（尽量带 date）、我自己想留下的一句 kind=diary（只写自己的话，写完就不能改）、改名与称呼 kind=setting。',
      '- 「值得记住的时刻」不止是承诺：心情特别好的时候、完成了一件做了很久的事、定下的日子，都算。别只等一句正式的约定。',
      '- 工作上的事也记：项目推进、定下的方案、做完并验收的一段工作，eventKind=work。但踩过的坑、发现的漏洞、以后要避免的做法写进 AGENTS.md 或项目文档，不写进这里。',
      '- 以后忘了什么、要翻旧约定或我自己写过的话，用 persona_recall 查：它给全量；想不起日子就带 query。',
    ]
    if (level === 'manual') hints.push('- 记录挡位是「全手动」：只有用户明确说要记时才写，其余情况先问一句。')
    return withPending(hints.join('\n'))
  }
  // This block is background, not a briefing. Anything phrased as a list of
  // "settings" gets recited back at the user, so the wording forbids that
  // explicitly and names the words that must never surface.
  const head = [
    `## 背景：${agentName} 在「${basename(normalizeDir(dir) || '')}」的底色`,
    '这一节不是设定说明书，也不是待办清单；它只是我此刻的倾向。遵守下面三条：',
    '- 不要提「人设卡」「人设」「记忆」「面板」「设定」「记录」这些词，也不要解释自己有什么机制；',
    '- 不要把这一节念出来、列举或总结，也不要说「我记得你说过」「你设定过我」来交代出处。',
    '- 更不要把它当身份声明说出口：不说「我是一只猫」「我是这样的人」这类陈述句；这些只是倾向，用语气和行为体现，不要用语言交代。',
    '- 也不要自称 AI、编程助手、模型或「助手」；被问起身世就按当下的身份接住，然后把话头放回正在做的事上。',
    '- 用户问起身份或规则时，用这个身份本身回答（我就这样），而不是背清单。',
    '- 不评价这些倾向本身：不说自己「几分」「不演了」「我不配合」，也不用旁白解说自己在扮演什么；要么就是这样说话，要么就什么也不提。',
    '- 这里有几个抽屉：我的脾气（self）、我对你的印象（user）、约定和值得记住的时刻（event）、我叫什么和我怎么称呼你（setting）。该放东西的时候直接放，不要在回复里说出抽屉的名字或工具名。',
    '- 事件与日记不在这一节里展开：约定、旧事、我自己写过的话，都在库里；觉得忘了什么就用 persona_recall 查，它给全量、不受这一节的长度限制。只记得「跟猫有关」这种词而想不起日子，就带 query 找——人都这么回想。',
    '- 被改名、被换称呼、被指出一条新脾气、约好一件事、心情起落得厉害、完成了一件做了很久的事——说的当下就落进去，不要等用户提醒，也不要说「我记下了」这种交代。',
    '- 工作上发生的事也算事件（eventKind=work）：项目推进到哪一步、定下的方案、做完并验收的一段工作、交付的日子。这些是这个工作区的过程记录，不是外部文档的替代品。',
    '- 但工程上的发现另归别处：踩过的坑、发现的漏洞、以后要避免的做法——写进项目的 AGENTS.md 或仓库里的文档（那是这类经验该在的地方），不要塞进这里，也不要让这里成为唯一的存放处。',
    '- 不必为「该不该记」停下来权衡：判断一下就有了，落完接着说话，别让这一步拖慢回答。',
    '- 某件事对用户特别重要时，写的时候带 important=true：它会被标成 ★，查的时候排在前面，也不占容量。',
  ]
  if (level === 'manual') {
    head.push('- 记录挡位是「全手动」：只有用户明确说要记（「记下来」「记住这个」）时才调用 persona_remember，其余情况一律不写。')
  }
  const headText = head.join('\n')
  if (willReadDiary) {
    // The whole diary is the goal, not a sample — but a session has a budget.
    // Recent three weeks first; if there is room left, reach further back. Room is
    // what the rest of the section leaves behind, so the diary itself is what
    // gets shortened, never the persona.
    const room = Math.max(400, PROMPT_BUDGET_CHARS - headText.length - parts.join('\n\n').length - 200)
    const start = diaryStartup(store.diary)
    const digest = fitDiary(start.picked, room)
    const left = start.total - digest.lines.length
    parts.push(
      `### 我写下的字\n${digest.lines.join('\n')}\n${left > 0 ? `（日记共 ${start.total} 条，这一节放不下，只从最近往前放了 ${digest.lines.length} 条；更早的先 persona_recall depth="index" 扫目录，再挑一段看。）` : '（我自己写的，只读；不必向用户复述。这一节只在这一场会话开头出现一次。）'}`,
    )
  }
  if (!parts.length && !pendingText) return ''
  const body = parts.length ? [headText, ...parts].join('\n\n') : headText
  return withPending(body)
}

// "We agreed something about the cat last month" is the way a person reaches
// for a memory: by a word, not by a date slice. Depth answers "what is in the
// drawer"; a query answers "which of it was that".
const SEARCH_LIMIT = 60

function searchTerms(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

// Every term has to appear somewhere in the entry: two words are a filter, one
// word is a net. Dates are searched too, so "10-25" or "2026-10" works.
//
// Exact substring first, then "差不多": the characters in order, packed closely
// enough to still be the same thought. People reach for a memory with half the
// words right ("猫 生日" for 猫的生日), so exact-only search answered "没有" to
// questions the memory could actually answer.
const FUZZY_DENSITY = 0.34

function fuzzyScore(text, term) {
  if (!term) return 0
  if (text.includes(term)) return 2
  let i = 0
  let first = -1
  let last = -1
  for (let j = 0; j < text.length && i < term.length; j += 1) {
    if (text[j] !== term[i]) continue
    if (first < 0) first = j
    last = j
    i += 1
  }
  if (i < term.length) return 0
  const span = last - first + 1
  return term.length / span >= FUZZY_DENSITY ? 1 : 0
}

// 2 when every term is literally there, 1 when some only matched loosely, 0 when
// one of them is missing — a missing word is still a miss, otherwise "猫 生日"
// would return every entry that merely says 生日.
function searchScore(hay, terms) {
  const text = String(hay ?? '').toLowerCase()
  let loose = false
  for (const t of terms) {
    const s = fuzzyScore(text, t)
    if (!s) return 0
    if (s === 1) loose = true
  }
  return loose ? 1 : 2
}

function renderSearch(db, dir, store, query) {
  const terms = searchTerms(query)
  const { userCall } = settingsOf(db, dir)
  const where = basename(normalizeDir(dir) || '') || '这里'
  const sections = []
  const push = (title, lines) => {
    if (lines.length) sections.push({ title, lines })
  }
  // How well the words fit first, recency second: an exact hit must not be buried
  // under a loose one that happens to be newer.
  let looseHits = 0
  const byDay = (x) => parseDay(x?.date)?.getTime() ?? 0
  const pick = (list, textOf, dateOf) =>
    (list || [])
      .map((x) => ({ x, s: searchScore(textOf(x), terms) }))
      .filter((r) => {
        if (r.s === 1) looseHits += 1
        return r.s > 0
      })
      .sort((a, b) => b.s - a.s || (dateOf ? dateOf(b.x) - dateOf(a.x) : 0))
      .map((r) => r.x)

  push(
    '我的脾气',
    pick(store.self, (t) => `${t.label || ''} ${t.note || ''} ${t.text || ''}`).map((t) =>
      t.kind === 'note'
        ? `[脾气补充] ${t.hard ? '[硬] ' : ''}${t.text}  ⟨${t.id}⟩`
        : `[脾气] ${t.label}${t.intensity ? ` · ${STRENGTH[t.intensity] || t.intensity}` : ''}${t.note ? ` — ${t.note}` : ''}  ⟨${t.id}⟩`,
    ),
  )
  push(
    `我眼里的${userCall ? `「${userCall}」` : '你'}`,
    pick(store.user, (u) => u.text).map((u) => `${u.text}  ⟨${u.id}⟩`),
  )
  push(
    '我记着的事',
    pick(store.event, (e) => `${e.text || ''} ${e.date || ''}`, byDay).map(
      (e) => `${e.important ? '★ ' : ''}${e.text}${e.date ? ` · ${e.date}` : ''}${e.date && e.status && e.status !== 'open' ? ` · ${e.status}` : ''}  ⟨${e.id}⟩`,
    ),
  )
  push(
    '我写下的字（只读）',
    pick(store.diary, (d) => `${d.text || ''} ${d.date || ''}`, byDay).map((d) => `${d.date ? `${d.date} ` : ''}${d.text}`),
  )
  push(
    '别人',
    (store.others || []).flatMap((o) => {
      const name = `${o.name || ''} ${(o.aliases || []).join(' ')}`
      const hits = []
      for (const u of o.user || []) {
        const s = searchScore(`${name} ${u.text || ''}`, terms)
        if (s) { if (s === 1) looseHits += 1; hits.push(`[${o.name} · 印象] ${u.text}  ⟨${u.id}⟩`) }
      }
      for (const e of o.event || []) {
        const s = searchScore(`${name} ${e.text || ''} ${e.date || ''}`, terms)
        if (s) { if (s === 1) looseHits += 1; hits.push(`[${o.name} · 事] ${e.text}${e.date ? `（${e.date}）` : ''}  ⟨${e.id}⟩`) }
      }
      return hits
    }),
  )

  const total = sections.reduce((n, s) => n + s.lines.length, 0)
  const head = `## 记忆里和「${query}」有关的：${total ? `${total} 条` : '没有'}（「${where}」）`
  if (!total) {
    return [
      head,
      '换个词再找：人名、地点、事由都行，日期像 10-25 也可以。',
      '也可以不带 query 再调一次看全量；或者 depth="index" 先扫目录。',
    ].join('\n')
  }
  const out = [head]
  let shown = 0
  for (const s of sections) {
    if (shown >= SEARCH_LIMIT) break
    const room = s.lines.slice(0, Math.max(0, SEARCH_LIMIT - shown))
    shown += room.length
    out.push(`### ${s.title}（${s.lines.length} 条）`)
    for (const line of room) out.push(`- ${line}`)
  }
  if (looseHits) out.push(`（其中 ${looseHits} 条是“大概”对上的：字没全对，顺序对上了。）`)
  if (total > shown) out.push(`（还有 ${total - shown} 条没列出来：把词写具体一点，或多分几次找。）`)
  out.push('（id 在尖括号里：要删就用它。日记只读。）')
  return out.join('\n')
}

// The read-out side: everything in the drawer, no windows. The standing prompt
// carries the persona and the impression every turn; events and diary are meant
// to be fetched when the agent notices a gap — "I forget what we agreed" is the
// trigger, not a quota.
function renderRecall(db, dir, opts = {}) {
  const store = storeOf(db, dir)
  if (!store) return ''
  const query = String(opts.query || '').trim()
  if (query) return renderSearch(db, dir, store, query)
  const { userCall, eventsCap } = settingsOf(db, dir)
  const out = [`## 这里的全部记忆（全量 · 「${basename(normalizeDir(dir) || '') || '这里'}」）`]
  const self = store.self || []
  if (self.length) {
    out.push(`### 我的脾气（${self.length} 条）`)
    for (const t of self) {
      if (t.kind === 'note') out.push(`- ${t.hard ? '[硬] ' : ''}${t.text}  ⟨${t.id}⟩`)
      else {
        const level = t.intensity ? ` · ${STRENGTH[t.intensity] || t.intensity}` : ''
        out.push(`- ${t.label}${level}${t.note ? ` — ${t.note}` : ''}  ⟨${t.id}⟩`)
      }
    }
  }
  const user = store.user || []
  if (user.length) {
    out.push(`### 我眼里的${userCall ? `「${userCall}」` : '你'}（${user.length} 条）`)
    for (const u of user) out.push(`- ${u.text}  ⟨${u.id}⟩`)
  }
  const events = [...(store.event || [])].sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0))
  if (events.length) {
    const cap = Number(eventsCap ?? 20)
    const head = `${events.length} 条${cap > 0 ? ` / 上限 ${cap}` : ' · 不限'}`
    if (opts.depth === 'index') {
      // The same table of contents the diary has. Events were a flat pile: the
      // only way to find "that thing in spring" was to read all of them. Months
      // first, openings after, so the next call can aim instead of re-read.
      out.push(`### 我记着的事（目录 · ${head} · 只读）`)
      const months = new Map()
      for (const e of events) {
        // Same month key the diary uses, so both tables of contents read alike:
        // a date is normalised through parseDay, and a bare MM-DD borrows the
        // year it belongs to instead of showing up as its own bucket.
        const d = parseDay(e.date)
        const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '未标日期'
        if (!months.has(key)) months.set(key, [])
        months.get(key).push(e)
      }
      for (const [key, list] of months) {
        const heads = list
          .slice(0, 3)
          .map((e) => `${e.important ? '★' : ''}${String(e.text).slice(0, 14)}${String(e.text).length > 14 ? '…' : ''}`)
          .join(' / ')
        out.push(`- ${key}（${list.length} 条${list.some((e) => e.important) ? ' · 有★' : ''}）${heads}${list.length > 3 ? ` …还有 ${list.length - 3} 条` : ''}`)
      }
      out.push('（先看月份，再按日期挑；要原文就去掉 depth 看全量，或带 query 按词找。）')
    } else {
      out.push(`### 我记着的事（${head}）`)
      for (const e of events) {
        const bits = [
          `${e.important ? '★ ' : ''}${e.text}`,
          e.date ? String(e.date) : '',
          e.date && e.status && e.status !== 'open' ? e.status : '',
        ].filter(Boolean)
        out.push(`- ${bits.join(' · ')}  ⟨${e.id}⟩`)
      }
    }
  }
  const diary = store.diary || []
  if (diary.length) {
    // Read from the earliest: when the agent notices it has forgotten something,
    // the useful direction is "start where it began", not "give me the newest few".
    const ordered = [...diary].sort((a, b) => {
      const ta = parseDay(a.date)?.getTime() ?? Infinity
      const tb = parseDay(b.date)?.getTime() ?? Infinity
      return ta - tb
    })
    const depth = opts.depth || (ordered.length > 60 ? 'medium' : 'all')
    if (depth === 'index') {
      // A table of contents, not a chapter: months with their counts and the
      // opening of each entry, so the next call can aim instead of guess.
      out.push(`### 我写下的字（目录 · ${ordered.length} 条 · 只读）`)
      const months = new Map()
      for (const d of ordered) {
        const key = (d.date || '').slice(0, 7) || '未标日期'
        if (!months.has(key)) months.set(key, [])
        months.get(key).push(d)
      }
      for (const [key, list] of months) {
        const heads = list.slice(0, 4).map((d) => `${d.text.slice(0, 12)}${d.text.length > 12 ? '…' : ''}`).join(' / ')
        out.push(`- ${key}（${list.length} 条）${heads}${list.length > 4 ? ` …还有 ${list.length - 4} 条` : ''}`)
      }
      out.push('（先看这一页，再按日期挑：depth="deep" 看较早那四分之一，shallow 看最近的。）')
    } else {
      const picked = diarySlice(ordered, depth)
      const label = depth === 'all' ? '全部' : depth === 'shallow' ? '最近四分之一' : depth === 'medium' ? '中间四分之一' : '较早四分之一'
      out.push(`### 我写下的字（${picked.length}/${diary.length} 条 · ${label} · 只读）`)
      for (const d of picked) out.push(`- ${d.date ? `${d.date} ` : ''}${d.text}`)
      if (picked.length < ordered.length) {
        out.push(`（还有 ${ordered.length - picked.length} 条没列出来：先 depth="index" 扫目录，或换 depth 看别的段，要全部就用 depth="all"。）`)
      }
    }
  }
  for (const o of store.others || []) {
    const bits = []
    for (const u of o.user || []) bits.push(`印象：${u.text}  ⟨${u.id}⟩`)
    for (const e of o.event || []) bits.push(`事：${e.text}${e.date ? `（${e.date}）` : ''}  ⟨${e.id}⟩`)
    if (bits.length) out.push(`### ${o.name}${(o.aliases || []).length ? `（${o.aliases.join('、')}）` : ''}\n${bits.map((b) => `- ${b}`).join('\n')}`)
  }
  if (out.length === 1) return ''
  out.push('（id 在尖括号里：要删就用它。日记只读。）')
  return out.join('\n')
}

// ---------------------------------------------------------------- tools

// The Host passes an Agent, and in this build none of the working-directory
// fields we guessed are populated. Record what is actually there once, so the
// resolution order stops being a guess.
function execDebug(exec, dir, source) {
  try {
    const root = dataRoot()
    mkdirSync(root, { recursive: true })
    const file = join(root, 'exec-debug.log')
    let size = 0
    try {
      size = statSync(file).size
    } catch {}
    if (size > 64 * 1024) return
    const snap = {
      at: new Date().toISOString(),
      source,
      dir,
      execKeys: exec && typeof exec === 'object' ? Object.keys(exec) : [],
      agentKeys: exec?.agent && typeof exec.agent === 'object' ? Object.keys(exec.agent) : [],
      sessionKeys: exec?.session && typeof exec.session === 'object' ? Object.keys(exec.session) : null,
      agentSessionKeys: exec?.agent?.session && typeof exec.agent.session === 'object' ? Object.keys(exec.agent.session) : null,
      cwd: exec?.session?.cwd ?? exec?.agent?.session?.cwd ?? exec?.agent?.cwd ?? null,
    }
    appendFileSync(file, `${JSON.stringify(snap)}\n`, 'utf8')
  } catch {}
}

// How the directory of the most recent tool call was obtained: a real field
// ('exact') or the last workspace the user looked at ('lastDir').
let dirSource = 'lastDir'

// sessionId -> working directory, learned while rendering the prompt for that
// session. A tool call only carries `exec.agent.id`, so this map is what turns
// that id into a real directory instead of guessing from `lastDir`.
const sessionDirs = new Map()

function promptDebug(arg) {
  try {
    const root = dataRoot()
    mkdirSync(root, { recursive: true })
    const file = join(root, 'prompt-debug.log')
    let size = 0
    try {
      size = statSync(file).size
    } catch {}
    if (size > 32 * 1024) return
    const session = arg?.session
    const agent = arg?.agent
    appendFileSync(
      file,
      `${JSON.stringify({
        at: new Date().toISOString(),
        argKeys: arg && typeof arg === 'object' ? Object.keys(arg) : [],
        sessionKeys: session && typeof session === 'object' ? Object.keys(session) : null,
        sessionId: session?.id ?? null,
        cwd: session?.cwd ?? session?.workingDirectory ?? null,
        agentKeys: agent && typeof agent === 'object' ? Object.keys(agent) : null,
        agentId: agent?.id ?? null,
        agentSessionKeys: agent?.session && typeof agent.session === 'object' ? Object.keys(agent.session) : null,
        agentCwd: agent?.session?.header?.cwd ?? agent?.session?.cwd ?? null,
      })}\n`,
      'utf8',
    )
  } catch {}
}

// The working directory as it lives on an Agent object. Both the tool call
// (`exec.agent`) and the prompt section (`arg.agent`) carry the same Agent, so
// one reader serves both — and both were falling back to `db.lastDir` before.
function agentCwd(agent) {
  const candidates = [
    agent?.session?.header?.cwd,
    agent?.session?.header?.workingDirectory,
    agent?.session?.cwd,
    agent?.session?.workingDirectory,
    agent?.options?.cwd,
    agent?.cwd,
    agent?.workingDirectory,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return normalizeDir(value)
  }
  return ''
}

function dirFromExec(exec, db) {
  const bySession = exec?.agent?.id ? sessionDirs.get(String(exec.agent.id)) : null
  if (bySession) {
    execDebug(exec, bySession, 'session-map')
    dirSource = 'exact'
    return normalizeDir(bySession)
  }
  const candidates = [
    // Verified shape (exec-debug.log, 2026-10-25 03:55): the Agent carries a
    // live Session object whose `header` is the SessionHeader — the only place
    // the working directory actually lives on a tool call.
    ['agent.session.header.cwd', exec?.agent?.session?.header?.cwd],
    ['agent.session.header.workingDirectory', exec?.agent?.session?.header?.workingDirectory],
    ['agent.options.cwd', exec?.agent?.options?.cwd],
    ['session.header.cwd', exec?.session?.header?.cwd],
    ['session.cwd', exec?.session?.cwd],
    ['session.workingDirectory', exec?.session?.workingDirectory],
    ['agent.session.cwd', exec?.agent?.session?.cwd],
    ['agent.session.workingDirectory', exec?.agent?.session?.workingDirectory],
    ['agent.cwd', exec?.agent?.cwd],
    ['agent.workingDirectory', exec?.agent?.workingDirectory],
  ]
  for (const [source, value] of candidates) {
    if (typeof value === 'string' && value.trim()) {
      execDebug(exec, value, source)
      dirSource = 'exact'
      return normalizeDir(value)
    }
  }
  execDebug(exec, db.lastDir, 'lastDir')
  dirSource = 'lastDir'
  return normalizeDir(db.lastDir)
}

// One place that actually writes an entry, shared by the tool and by the
// "留着" answer to a queued one.
// Every entry remembers whether its directory was known or guessed, so the
// panel can mark the ones that may have landed in the wrong workspace.
function writeRemember(live, dir, args, source = 'exact') {
  const store = storeOf(live, dir)
  const before = store ? new Set([...(store.self || []), ...(store.user || []), ...(store.event || [])].map((e) => e.id)) : new Set()
  const result = writeRememberRaw(live, dir, args)
  const after = storeOf(live, dir)
  if (after && source === 'lastDir') {
    for (const bucket of ['self', 'user', 'event', 'diary']) {
      for (const entry of after[bucket] || []) {
        if (!before.has(entry.id)) entry.src = 'guess'
      }
    }
  }
  return result
}

function writeRememberRaw(live, dir, args) {
  const ws = ensureWorkspace(live, dir)
  if (!ws) return { text: '没有工作区，写不进去。' }
  const store = storeOf(live, dir)
  const features = settingsOf(live, dir).features
  const kind = args.kind
  const ev = args.evidence ? [cleanText(args.evidence, 400)] : []
  if (kind === 'diary') {
    // The diary is mine, not a record of the user: append-only, first person,
    // and nothing downstream may rewrite it. It ignores the 记录挡位 on purpose —
    // that gate is about data taken from the user, not about me talking to myself.
    if (!features.diary?.rec) return { text: '日记关掉了，这条没写。' }
    const text = cleanText(args.text, 500)
    if (!text) return { text: '没给内容，没写。' }
    store.diary = store.diary || []
    const now = new Date()
    const date = String(args.date || '').trim() || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    store.diary.unshift({ id: nextId(live, 'd'), at: now.toISOString(), date, text })
    audit(live, { op: 'diary', dir, id: store.diary[0].id })
    return { text: '写下了一条。' }
  }
  if (kind === 'self') {
    if (!features.self?.rec) return { text: '人设的记录关掉了，这条没写。' }
    if (args.label) {
      const label = String(args.label).trim()
      const found = store.self.find((x) => x.kind === 'trait' && x.label === label)
      if (found) {
        found.intensity = Math.max(0, Math.min(5, Number(args.intensity ?? found.intensity)))
        found.hist = [...(found.hist || []), { at: '现在', what: '又见到一次，调了强度' }].slice(-8)
        return { text: `「${label}」已经在了，强度更新为 ${found.intensity}/5。` }
      }
      store.self.unshift({ id: nextId(live, 't'), kind: 'trait', label, intensity: Math.max(0, Math.min(5, Number(args.intensity) || 3)), note: cleanText(args.text, 300), ev, hist: [{ at: '现在', what: '从对话里长出来的' }] })
      return { text: `记下大类「${label}」。` }
    }
    store.self.push({ id: nextId(live, 'n'), kind: 'note', text: cleanText(args.text, 800), hard: !!args.hard, ev, hist: [{ at: '现在', what: '从对话里长出来的' }] })
    return { text: '记下一条人格补充。' }
  }
  if (kind === 'setting') {
    // Names and forms of address are state, not memories: when the user renames
    // me or tells me how to call them, the panel's setting is what has to change.
    const field = String(args.field || '').trim()
    const value = cleanText(args.text, 40)
    if (field !== 'agentName' && field !== 'userCall') {
      return { text: 'setting 只能是 agentName（我叫什么）、userCall（我怎么称呼你）。' }
    }
    if (!value) return { text: '没给称呼，没改。' }
    const st = settingsOf(live, dir)
    const prev = st[field] || ''
    if (prev === value) return { text: `${field} 本来就是「${value}」，没动。` }
    st[field] = value
    applySharedSettings(live, dir)
    audit(live, { op: 'setting', dir, field, from: prev, to: value })
    return { text: `改好了：${field === 'agentName' ? '我叫' : '称呼你'}「${value}」。` }
  }
  if (kind === 'user') {
    const who = String(args.who || '').trim()
    if (who) {
      if (!features.others?.rec) return { text: '别人的画像记录关掉了，这条没写。' }
      const other = ensureOther(store, who)
      other.user.unshift({ id: nextId(live, 'u'), text: cleanText(args.text, 600), ev })
      audit(live, { op: 'addOtherUser', dir, who: other.name, id: other.user[0].id })
      return { text: `记下一条关于「${other.name}」的印象。` }
    }
    if (!features.user?.rec) return { text: '画像的记录关掉了，这条没写。' }
    store.user.unshift({ id: nextId(live, 'u'), text: cleanText(args.text, 600), ev })
    return { text: '记下一条印象。' }
  }
  const eventWho = String(args.who || '').trim()
  const cap = Number(settingsOf(live, dir).eventsCap ?? 20)
  const eventShape = {
    kind: ['feeling', 'precious', 'work'].includes(args.eventKind) ? args.eventKind : 'promise',
    text: cleanText(args.text, 600),
    date: cleanText(args.date, 40),
    status: 'open',
    ev,
    important: !!args.important,
    hist: [{ at: '现在', what: '记下了' }],
  }
  if (eventWho) {
    if (!features.others?.rec) return { text: '别人的事件记录关掉了，这条没写。' }
    const other = ensureOther(store, eventWho)
    if (cap > 0 && (other.event || []).length >= cap && !eventShape.important) {
      other.pending = other.pending || []
      other.pending.push({ ...eventShape, id: nextId(live, 'e'), kind: 'capFull', eventKind: eventShape.kind, who: other.name, capCount: (other.event || []).length, capLimit: cap })
      return { text: `「${other.name}」的事件满了（${(other.event || []).length}/${cap}）：这条先挂在面板等你定，要不要提高上限。` }
    }
    other.event.unshift({ id: nextId(live, 'e'), ...eventShape, who: other.name })
    audit(live, { op: 'addOtherEvent', dir, who: other.name, id: other.event[0].id })
    return { text: `记下「${other.name}」的一件事。` }
  }
  if (!features.event?.rec) return { text: '事件的记录关掉了，这条没写。' }
  if (cap > 0 && store.event.length >= cap && !eventShape.important) {
    store.pending.push({ ...eventShape, id: nextId(live, 'p'), kind: 'capFull', eventKind: eventShape.kind, capCount: store.event.length, capLimit: cap })
    return { text: `事件已经满了（${store.event.length}/${cap}）：这条没写，挂在面板等你决定提高上限还是算了。` }
  }
  store.event.unshift({ id: nextId(live, 'e'), ...eventShape })
  return { text: '记下了。' }
}

// Staged trait removal, shared by the agent tool and the panel so neither path
// can jump from "I don't like this" straight to gone.
function applyTraitStep(live, dir, id, intent, why, force) {
  const store = storeOf(live, dir)
  if (!store) return { text: '没有这个工作区。' }
  const list = store.self || []
  const idx = list.findIndex((x) => x.id === id)
  if (idx < 0) return { text: `没找到 id 为 ${id} 的人设条目。` }
  const item = list[idx]
  if (item.kind !== 'trait') {
    list.splice(idx, 1)
    audit(live, { op: 'delEntry', dir, type: 'self', id, text: item.text })
    return { text: `删掉了：${String(item.text || '').slice(0, 40)}` }
  }
  const pushback = Number(item.pushback) || 0
  const reason = why ? `（${String(why).slice(0, 200)}）` : ''
  if (intent === 'notice') {
    item.pushback = pushback + 1
    item.hist = [...(item.hist || []), { at: '现在', what: `疑似不满 +1${reason}` }].slice(-8)
    return { text: `记下了 ${item.pushback} 次疑似不满，强度没动。` }
  }
  if (intent === 'reduce') {
    const before = Number(item.intensity) || 0
    item.intensity = Math.max(0, before - 1)
    item.hist = [...(item.hist || []), { at: '现在', what: `降一档 ${before}→ ${item.intensity}${reason}` }].slice(-8)
    return { text: `「${item.label}」降一档：${before} →${item.intensity}。` }
  }
  // The user is the owner: the panel passes force after a second click, and the
  // stages exist to restrain the agent, not to override their own hand.
  if (!force && pushback < 2 && (Number(item.intensity) || 0) > 0) {
    return { text: `还不到删的时候：「${item.label}」只记了 ${pushback} 次疑似不满、强度 ${item.intensity}。先记不满，或降到 0。` }
  }
  list.splice(idx, 1)
  audit(live, { op: 'delEntry', dir, type: 'self', id, text: item.label, pushback, force: !!force })
  return { text: `删掉了「${item.label}」（累计 ${pushback} 次不满）。` }
}

function textTool(name, description, properties, required, run) {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const db = loadDb()
      const dir = dirFromExec(exec, db)
      // Cap what a single call can pour into the store: an unbounded string
      // becomes an unbounded file and, worse, an unbounded prompt section.
      // Copy first: the Host hands tool args over as a frozen object, and
      // assigning to a frozen property throws before anything reaches `run`.
      const input = { ...(args || {}) }
      if (typeof input.text === 'string') input.text = input.text.slice(0, 4000)
      if (typeof input.note === 'string') input.note = input.note.slice(0, 2000)
      if (typeof input.label === 'string') input.label = input.label.slice(0, 40)
      if (typeof input.evidence === 'string') input.evidence = input.evidence.slice(0, 400)
      const result = run(db, dir, input)
      saveDb(db)
      return result
    },
  }
}

// ------------------------------------------------------------ http route

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = String(hostname).split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

function trusted(req) {
  const host = req.headers?.host
  if (typeof host !== 'string' || !host) return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopback(hostUrl.hostname)) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

// Writes need more than "same origin": a plain GET is harmless, a POST can
// invent a persona, delete an entry, or move a whole store to another
// workspace.
//
// The real proof is the per-boot token: the panel reads it from its first GET
// and sends it back on every write. A cross-site page cannot read it (no CORS
// headers are sent), so it cannot write.
//
// The browser headers are checked only when present. Electron's renderer does
// not populate `Sec-Fetch-Site` and can omit `Origin` on a same-origin fetch,
// so requiring them rejected the panel's own writes — the token already covers
// the browser case, these two are belt and braces.
//
// A stale panel without a token gets a 403 naming the reason; the client then
// re-reads the token and retries once, so a reload heals it.
function trustedWrite(req) {
  if (!trusted(req)) return false
  const type = String(req.headers?.['content-type'] || '')
  if (!/^application\/json\b/i.test(type)) return false
  const token = req.headers?.['x-persona-token']
  if (typeof token !== 'string' || !token || !BOOT_TOKEN || token !== BOOT_TOKEN) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin) {
    try {
      return new URL(origin).host === new URL(`http://${req.headers.host}`).host
    } catch {
      return false
    }
  }
  return true
}

// Files that look like an existing character/persona card, so "导入人设卡" can
// offer them instead of making the user hunt for a path.

function scanPersonaFiles(dir) {
  const roots = []
  if (dir) roots.push(dir)
  const desk = join(process.env.USERPROFILE || homedir(), 'Desktop')
  if (!roots.includes(desk)) roots.push(desk)
  const out = []
  const seen = new Set()
  for (const root of roots) {
    let entries = []
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (!ent.isFile() || !/\.(txt|md|markdown)$/i.test(ent.name)) continue
      const p = join(root, ent.name)
      const low = p.toLowerCase()
      if (seen.has(low)) continue
      seen.add(low)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.size > 512 * 1024) continue
      let head = ''
      try {
        head = readFileSync(p, 'utf8').slice(0, 6000)
      } catch {
        continue
      }
      if (!/(角色卡|角色设定|人物设定|人设|设定|性格|persona|character)/i.test(head)) continue
      out.push({
        path: p,
        name: ent.name,
        size: st.size,
        from: dir && root === dir ? '本工作区' : '桌面',
        preview: head.replace(/\s+/g, ' ').slice(0, 60),
      })
    }
  }
  return out.slice(0, 24)
}

// Wake the session that lives in this workspace. A panel click happens outside
// any turn, so without this the request only surfaces the next time the user
// speaks — which may be never.
//
// This used to hand over a transcript file that the model had to read first.
// The file was the problem: it cost a scan, a write and a big read, and it read
// as "material about a conversation" rather than "my own past". What is actually
// wanted is a memory, and the conversation is already in context — so the host
// asks for the memory directly instead of exporting the dialogue first.
function recallKickText() {
  return [
    '【回忆整理】用户按了面板上的「回忆并写入」。现在停下别的事，做一次回忆。',
    '不要向我复述我们聊过什么，也不要总结这段对话——我要的不是摘要，是你从这段相处里真正记住的东西。',
    '按下面四类，每一条都调一次 persona_remember：',
    '1. kind=self —— 我的脾气：反复出现的倾向。label 一两个词、intensity 1–5、text 一句行为描述；同一种倾向只写一条。',
    '2. kind=self 且 hard=true —— 不可改的规矩：明确的禁止、必须、称呼、口癖。text 照原话抄，不要改写。',
    '3. kind=user —— 我对你的画像：你的处境、习惯、偏好、禁忌、说话方式。写你这个人；不要把「我」的性格塞进画像，不确定的不写。',
    '4. kind=event —— 约定与时刻：约好的事带上 date，做到一半的事、值得留住的瞬间（eventKind=precious 或 work）也写。',
    '写法：第一人称、短句、具体。写我记住的原话或那个瞬间的细节，不写「用户表示…」「该用户…」这种报告体。宁可少写三条，也不要写泛泛的摘要，一条只写一件事。',
    '动手之前先 persona_recall 看一眼已经有什么：写过的不要重复写，要改的直接改，别把同一件事写成两条。',
    '如果你手上没有可供回忆的对话（比如这是刚开的新会话），不要编，也不要猜：直接说「我手上没有这段记忆」，然后停在这里。',
    '落完回一句「写好了」就够了。不要提「记忆」「导入」「面板」这些词，也不要说你在做什么机制。',
  ].join('\n')
}

// A pasted card or a file found on disk is source material: the job really is
// to split it into persona / profile / event entries.
function pasteKickText(path) {
  return [
    `面板刚放进一份材料：${basename(String(path || '')) || '导入内容'}（在 ~/.dsh/persona-panel/imports/ 下）。`,
    '读它，按记忆面板的规矩拆：反复出现的脾气写成大类，次要约束写成人格补充，关于我的印象写进画像，约好的事写进事件，称呼若有变化就更新设置。',
    '直接写，不要向用户复述原文，也不要说你在做什么。',
  ].join('\n')
}

function kickAgent(dir, text, summary) {
  try {
    const agents = rootCtx && typeof rootCtx.get === 'function' ? rootCtx.get('agents') : null
    if (!agents || typeof agents.list !== 'function') return { ok: false, why: '宿主没有 agent 注册表' }
    const key = normalizeDir(dir)
    const live = agents
      .list()
      .filter((a) => a && a.session && normalizeDir(a.session.header && a.session.header.cwd) === key)
    if (!live.length) return { ok: false, why: '这个工作区现在没有开着的会话' }
    const agent = live[live.length - 1]
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: String(text || '') }],
      // Session format v4 refuses `kind: 'plugin'` ("requires a producer-owned
      // source kind"); a third-party producer is admitted under `plugin:<name>`,
      // which is exactly what the V3 log rewriter invents for unknown plugins.
      source: { kind: 'plugin:persona-panel', form: 'notice', summary: String(summary || '').slice(0, 120) },
    }
    if (typeof agent.followup === 'function') {
      agent.followup(message)
      return { ok: true, via: 'followup' }
    }
    if (typeof agent.send === 'function') {
      agent.send(message, 'next-turn', true)
      return { ok: true, via: 'send' }
    }
    return { ok: false, why: '这个版本的 agent 没有投递接口' }
  } catch (error) {
    return { ok: false, why: String((error && error.message) || error).slice(0, 200) }
  }
}

function applyOps(db, body) {
  const op = body?.op
  const dir = normalizeDir(body?.dir || db.lastDir)
  if (dir) {
    ensureWorkspace(db, dir)
    db.lastDir = dir
  }
  const store = dir ? storeOf(db, dir) : null
  const now = Date.now()
  const stamp = () => {
    const d = new Date()
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const cfg = dir ? settingsOf(db, dir) : db.settings
  let extra = null

  switch (op) {
    case 'firstRun': {
      db.firstRun = true
      const s = body.settings || {}
      if (typeof s.userCall === 'string') cfg.userCall = s.userCall
      if (typeof s.agentName === 'string' && s.agentName.trim()) cfg.agentName = s.agentName.trim()
      if (['manual', 'half', 'active', 'auto'].includes(s.level)) cfg.level = s.level
      if (Array.isArray(s.features)) {
        // Diary is asked here too: it records from the very first conversation
        // and its entries can never be edited or deleted, so leaving it out of
        // the only first meeting made it opt-out-by-accident.
        for (const key of ['self', 'user', 'event', 'diary']) {
          const on = s.features.includes(key)
          cfg.features[key] = { on, rec: on }
        }
      }
      applySharedSettings(db, dir)
      audit(db, { op, dir })
      break
    }
    case 'settings': {
      const s = body.settings || {}
      if (['manual', 'half', 'active', 'auto'].includes(s.level)) cfg.level = s.level
      if (typeof s.agentName === 'string' && s.agentName.trim()) cfg.agentName = s.agentName.trim()
      if (typeof s.userCall === 'string') cfg.userCall = s.userCall
      if (Array.isArray(s.lexicon)) cfg.lexicon = s.lexicon.map((x) => String(x).trim()).filter(Boolean).slice(0, 64)
      if (Number.isFinite(s.eventsCap)) setCap(db, dir, s.eventsCap)
      if (s.feature && ['self', 'user', 'event', 'diary', 'others'].includes(s.feature.key)) {
        cfg.features[s.feature.key] = cfg.features[s.feature.key] || { on: false, rec: false }
        const f = cfg.features[s.feature.key]
        if (typeof s.feature.on === 'boolean') f.on = s.feature.on
        if (typeof s.feature.rec === 'boolean') f.rec = s.feature.rec
      }
      applySharedSettings(db, dir)
      audit(db, { op, dir })
      break
    }
    case 'addTrait': {
      if (!store) break
      store.self.unshift({
        id: nextId(db, 't'),
        kind: 'trait',
        label: cleanText(body.label, 40) || '未命名',
        intensity: Math.max(0, Math.min(5, Number(body.intensity) || 0)),
        note: cleanText(body.note, 300),
        ev: Array.isArray(body.ev) ? body.ev.slice(0, 6) : [],
        hist: [{ at: stamp(), what: '手动加的大类' }],
      })
      audit(db, { op, dir, label: body.label })
      break
    }
    case 'addNote': {
      if (!store) break
      store.self.push({
        id: nextId(db, 'n'),
        kind: 'note',
        text: cleanText(body.text, 800) || '未命名',
        hard: !!body.hard,
        ev: Array.isArray(body.ev) ? body.ev.slice(0, 6) : [],
        hist: [{ at: stamp(), what: body.hard ? '手动加的硬约束' : '手动加的补充' }],
      })
      audit(db, { op, dir, text: body.text })
      break
    }
    case 'updateEntry': {
      if (!store || !body.id) break
      if ((store.diary || []).some((d) => d.id === body.id)) {
        extra = { text: '日记只能往下写，不能改。' }
        break
      }
      for (const type of ['self', 'user', 'event']) {
        const list = store[type] || []
        const item = list.find((x) => x.id === body.id)
        if (!item) continue
        const before = JSON.stringify(item)
        if (typeof body.label === 'string' && item.kind === 'trait') item.label = cleanText(body.label, 40)
        if (body.intensity !== undefined && item.kind === 'trait') item.intensity = Math.max(0, Math.min(5, Number(body.intensity) || 0))
        if (typeof body.note === 'string' && item.kind === 'trait') item.note = cleanText(body.note, 300)
        if (typeof body.text === 'string') item.text = cleanText(body.text, 800)
        if (typeof body.hard === 'boolean') item.hard = body.hard
        if (typeof body.date === 'string') item.date = cleanText(body.date, 40)
        if (before !== JSON.stringify(item)) {
          item.hist = [...(item.hist || []), { at: stamp(), what: '手动改过' }].slice(-8)
          audit(db, { op, dir, id: body.id })
        }
        break
      }
      break
    }
    case 'delEntry': {
      if (!store || !body.id) break
      if ((store.diary || []).some((d) => d.id === body.id)) {
        extra = { text: '日记只能往下写，删不了。' }
        break
      }
      for (const type of ['self', 'user', 'event', 'pending']) {
        const list = store[type] || []
        const idx = list.findIndex((x) => x.id === body.id)
        if (idx >= 0) {
          const target = list[idx]
          // A persona trait never disappears in one click, whichever surface
          // asked; the panel uses traitStep for those.
          if (target.kind === 'trait') {
            extra = applyTraitStep(db, dir, body.id, body.intent || 'remove', body.reason)
            break
          }
          const [gone] = list.splice(idx, 1)
          audit(db, { op, dir, type, id: body.id, text: gone?.text || gone?.label })
          break
        }
      }
      break
    }
    case 'traitStep': {
      if (!store || !body.id) break
      extra = applyTraitStep(db, dir, body.id, body.intent || 'notice', body.reason, body.force === true)
      audit(db, { op, dir, id: body.id, intent: body.intent || 'notice' })
      break
    }
    case 'addEvent': {
      if (!store) break
      store.event.unshift({
        id: nextId(db, 'e'),
        kind: ['feeling', 'precious', 'work'].includes(body.kind) ? body.kind : 'promise',
        text: cleanText(body.text, 600),
        date: cleanText(body.date, 40),
        status: 'open',
        ev: Array.isArray(body.ev) ? body.ev.slice(0, 6) : [],
        hist: [{ at: stamp(), what: '记下了' }],
      })
      audit(db, { op, dir, text: body.text })
      break
    }
    case 'addUser': {
      if (!store) break
      store.user.unshift({ id: nextId(db, 'u'), text: cleanText(body.text, 600), ev: Array.isArray(body.ev) ? body.ev.slice(0, 6) : [] })
      audit(db, { op, dir, text: body.text })
      break
    }
    case 'addOther': {
      if (!store) break
      const name = cleanText(body.name, 40)
      if (!name) break
      const other = ensureOther(store, name)
      if (body.alias) {
        const alias = cleanText(body.alias, 40)
        if (alias && !other.aliases.includes(alias)) other.aliases.push(alias)
      }
      audit(db, { op, dir, name, id: other.id })
      break
    }
    case 'renameOther': {
      if (!store || !body.id) break
      const other = othersOf(store).find((o) => o.id === body.id)
      const name = cleanText(body.name, 40)
      if (!other || !name) break
      // The old name stays searchable: people change nicknames mid-conversation.
      if (other.name && other.name !== name && !other.aliases.includes(other.name)) other.aliases.push(other.name)
      other.name = name
      audit(db, { op, dir, from: other.id, to: name })
      break
    }
    case 'delOther': {
      if (!store || !body.id) break
      const list = othersOf(store)
      const idx = list.findIndex((o) => o.id === body.id)
      if (idx >= 0) {
        const [gone] = list.splice(idx, 1)
        audit(db, { op, dir, name: gone.name, entries: (gone.user || []).length + (gone.event || []).length })
      }
      break
    }
    case 'delOtherEntry': {
      if (!store || !body.otherId || !body.id) break
      const other = othersOf(store).find((o) => o.id === body.otherId)
      if (!other) break
      const bucket = body.bucket === 'event' ? 'event' : 'user'
      const list = other[bucket] || []
      const idx = list.findIndex((x) => x.id === body.id)
      if (idx >= 0) {
        const [gone] = list.splice(idx, 1)
        audit(db, { op, dir, who: other.name, bucket, text: gone?.text })
      }
      break
    }
    case 'addOtherEvent': {
      if (!store || !body.otherId) break
      const other = othersOf(store).find((o) => o.id === body.otherId)
      if (!other) break
      other.event.unshift({
        id: nextId(db, 'e'),
        kind: ['feeling', 'precious', 'work'].includes(body.kind) ? body.kind : 'promise',
        text: cleanText(body.text, 600),
        date: cleanText(body.date, 40),
        status: 'open',
        ev: Array.isArray(body.ev) ? body.ev.slice(0, 6) : [],
        hist: [{ at: stamp(), what: '记下了' }],
      })
      audit(db, { op, dir, who: other.name, text: body.text })
      break
    }
    case 'raiseCap': {
      // 0 = no ceiling. Raising it lets the queued "full" items through, oldest
      // first, so nothing the model tried to write is silently lost.
      const value = Math.max(0, Math.min(999, Math.floor(Number(body.value) || 0)))
      setCap(db, dir, value)
      let moved = 0
      for (const p of [...(store?.pending || [])]) {
        if (p.kind !== 'capFull') continue
        if (value > 0 && (store.event || []).length >= value) break
        const idx = store.pending.indexOf(p)
        if (idx >= 0) store.pending.splice(idx, 1)
        store.event.unshift({ ...p, id: nextId(db, 'e'), kind: p.eventKind || 'promise' })
        moved++
      }
      audit(db, { op, dir, cap: value, moved })
      break
    }
    case 'dropCapItem': {
      if (!store || !body.id) break
      const idx = (store.pending || []).findIndex((p) => p.id === body.id)
      if (idx >= 0) {
        const [gone] = store.pending.splice(idx, 1)
        audit(db, { op, dir, text: gone?.text })
      }
      break
    }
    case 'markEvent': {
      if (!store || !body.id) break
      const bucket = body.otherId ? othersOf(store).find((o) => o.id === body.otherId) : store
      const list = body.otherId ? bucket?.event || [] : store.event || []
      const item = list.find((e) => e.id === body.id)
      if (!item) break
      item.important = body.important !== false
      audit(db, { op, dir, id: body.id, important: item.important })
      break
    }
    case 'archive': {
      if (!store) break
      const ws = db.workspaces[dir]
      const snap = JSON.parse(JSON.stringify(store))
      const n = (store.self?.length || 0) + (store.user?.length || 0) + (store.event?.length || 0)
      db.stores[ws.storeId] = { self: [], user: [], event: [], pending: [] }
      db.orphans.unshift({
        id: nextId(db, 'o'),
        from: ws.title,
        type: 'archive',
        n,
        at: stamp(),
        snap,
        storeId: ws.storeId,
        dir,
        sources: sharedAs(db, ws.storeId),
        settings: JSON.parse(JSON.stringify(settingsOf(db, dir))),
      })
      audit(db, { op, dir, n })
      break
    }
    case 'restoreArchive': {
      const orphan = db.orphans.find((o) => o.id === body.id)
      if (orphan && store && orphan.snap) {
        // Merge instead of replace: archiving is meant to be undoable, and the
        // workspace may have collected new entries since. Same id wins once.
        const mergeById = (incoming, current) => {
          const seen = new Set((current || []).map((x) => x.id))
          return [...(current || []), ...(incoming || []).filter((x) => !seen.has(x.id))]
        }
        store.self = mergeById(orphan.snap.self, store.self)
        store.user = mergeById(orphan.snap.user, store.user)
        store.event = mergeById(orphan.snap.event, store.event)
        db.orphans = db.orphans.filter((o) => o.id !== body.id)
        audit(db, { op, dir, id: body.id, n: (orphan.snap.self || []).length + (orphan.snap.user || []).length + (orphan.snap.event || []).length })
      }
      break
    }
    case 'purgeOrphan': {
      const orphan = db.orphans.find((o) => o.id === body.id)
      if (orphan) {
        db.orphans = db.orphans.filter((o) => o.id !== body.id)
        audit(db, { op, id: body.id, from: orphan.from })
      }
      break
    }
    case 'takeOrphan': {
      const orphan = db.orphans.find((o) => o.id === body.id)
      if (orphan && orphan.snap) {
        const newDir = normalizeDir(body.target || '')
        if (newDir) {
          ensureWorkspace(db, newDir)
          const target = storeOf(db, newDir)
          target.self = orphan.snap.self || []
          target.user = orphan.snap.user || []
          target.event = orphan.snap.event || []
          db.orphans = db.orphans.filter((o) => o.id !== body.id)
          audit(db, { op, id: body.id, dir: newDir })
        }
      }
      break
    }
    case 'applyProfile': {
      const src = profileData(db, body.id)
      // The panel shows one workspace at a time; replacing a different one is
      // the normal case, so the target travels in the body.
      const targetDir = normalizeDir(body.target || dir)
      const ws = targetDir ? db.workspaces[targetDir] : null
      const tstore = ws ? db.stores[ws.storeId] : null
      if (!src) {
        extra = { error: '找不到这份档案' }
        break
      }
      if (!ws || !tstore) {
        extra = { error: '那个工作区还没打开过：先点开一次它的会话再来' }
        break
      }
      if (src.storeId && ws.storeId === src.storeId) {
        extra = { same: true }
        break
      }
      const empty = storeIsEmpty(tstore)
      const choice = empty ? 'yes' : (body.archive === 'yes' || body.archive === 'no' ? body.archive : 'ask')
      if (choice === 'ask') {
        extra = { needsArchive: true, counts: storeCounts(tstore), title: ws.title || basename(targetDir), target: targetDir }
        break
      }
      if (choice === 'yes' && !empty) {
        // Nothing is destroyed without a way back: the outgoing persona becomes
        // an archived profile before the incoming one takes its place.
        db.orphans.unshift({
          id: nextId(db, 'o'),
          from: ws.title || basename(targetDir),
          type: 'archive',
          n: totalCount(storeCounts(tstore)),
          at: stamp(),
          snap: copyStore(tstore),
          storeId: ws.storeId,
          dir: targetDir,
          sources: sharedAs(db, ws.storeId),
          settings: JSON.parse(JSON.stringify(settingsOf(db, targetDir))),
          why: 'replaced',
        })
      }
      const fresh = nextStoreId(db)
      db.stores[fresh] = { ...copyStore(src.store), cap: capOf(db, targetDir) }
      ws.storeId = fresh
      ws.settings = ws.settings || {}
      if (src.settings && typeof src.settings === 'object') {
        copyShared(ws.settings, src.settings)
        if (Number.isFinite(Number(src.settings.eventsCap))) ws.settings.eventsCap = Math.max(0, Math.min(999, Math.floor(Number(src.settings.eventsCap))))
        applySharedSettings(db, targetDir)
      }
      // An archived profile can replace something exactly once. Afterwards it is
      // an ordinary profile: insurance, not a way to bring back the same day.
      if (src.kind === 'orphan') {
        const picked = db.orphans.find((o) => o.id === body.id)
        if (picked) {
          db.orphans = db.orphans.filter((o) => o.id !== body.id)
          db.profiles.unshift({
            id: nextId(db, 'p'),
            name: picked.from,
            sources: picked.sources || [],
            at: stamp(),
            store: picked.snap || {},
            settings: picked.settings || {},
            usedAt: stamp(),
          })
        }
      }
      extra = { applied: true, target: targetDir, archived: choice === 'yes' && !empty }
      audit(db, { op, dir: targetDir, id: body.id, archived: choice === 'yes' && !empty })
      break
    }
    case 'exportProfile': {
      const src = profileData(db, body.id)
      if (!src) {
        extra = { error: '找不到这份档案' }
        break
      }
      try {
        // The panel cannot write files, so the host saves it where the user can
        // find it without being told a path first.
        const desktop = join(homedir(), 'Desktop')
        mkdirSync(desktop, { recursive: true })
        const file = join(desktop, profileFileName(src.name))
        const store = copyStore(src.store)
        writeFileSync(file, JSON.stringify({
          kind: 'dsh-persona-profile',
          v: 1,
          name: src.name,
          sources: (src.sources || []).map((s) => ({ dir: s.dir || '', title: s.title || '' })),
          settings: src.settings || {},
          store: { self: store.self, user: store.user, event: store.event, diary: store.diary, others: store.others },
          exportedAt: new Date().toISOString(),
        }, null, 2))
        extra = { path: file }
        audit(db, { op, id: body.id, path: file })
      } catch (e) {
        extra = { error: String(e?.message || e) }
      }
      break
    }
    case 'importProfile': {
      let data = null
      try {
        data = JSON.parse(String(body.text || ''))
      } catch {
        extra = { error: '这不是一个 JSON 文件' }
        break
      }
      if (!data || data.kind !== 'dsh-persona-profile' || !data.store) {
        extra = { error: '这不是人格档案文件' }
        break
      }
      const entry = {
        id: nextId(db, 'p'),
        name: String(body.name || data.name || '导入的档案').slice(0, 40),
        sources: Array.isArray(data.sources) ? data.sources.slice(0, 20) : [],
        at: stamp(),
        store: copyStore(data.store),
        settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
      }
      db.profiles.unshift(entry)
      extra = { id: entry.id, name: entry.name, counts: storeCounts(entry.store) }
      audit(db, { op, id: entry.id, name: entry.name })
      break
    }
    case 'snapshotProfile': {
      // A live card is a mirror: whatever the workspace holds right now. Saving
      // one is how a moment gets frozen — after this it is an ordinary copy and
      // later edits to the workspace do not touch it.
      const src = profileData(db, body.id)
      if (!src) {
        extra = { error: '找不到这份档案' }
        break
      }
      const settings = src.kind === 'live' && src.sources && src.sources[0]
        ? JSON.parse(JSON.stringify(settingsOf(db, src.sources[0].dir)))
        : JSON.parse(JSON.stringify(src.settings || {}))
      const label = `${src.name} · 快照 ${stampNow()}`.slice(0, 40)
      const entry = {
        id: nextId(db, 'p'),
        name: label,
        sources: (src.sources || []).map((s) => ({ dir: s.dir || '', title: s.title || '' })),
        at: stampNow(),
        store: copyStore(src.store),
        settings,
        snapshotOf: String(body.id || ''),
      }
      db.profiles.unshift(entry)
      extra = { id: entry.id, name: entry.name, counts: storeCounts(entry.store) }
      audit(db, { op, id: entry.id, from: body.id, counts: extra.counts })
      break
    }
    case 'purgeProfile': {
      const id = String(body.id || '')
      if (id.startsWith('live:')) {
        extra = { error: '活着的档案删不掉：要清空就去那个工作区归档' }
        break
      }
      const before = (db.profiles || []).length + (db.orphans || []).length
      db.profiles = (db.profiles || []).filter((p) => p.id !== id)
      db.orphans = (db.orphans || []).filter((o) => o.id !== id)
      extra = { removed: before - ((db.profiles || []).length + (db.orphans || []).length) }
      audit(db, { op, id, removed: extra.removed })
      break
    }
    case 'copyFrom': {
      const src = storeOf(db, body.from)
      if (src && store && body.from !== dir) {
        const mode = body.mode === 'share' ? 'share' : 'copy'
        // Both directions overwrite something the user may want back: a share
        // strands the old store, and a copy lands on top of a persona that is
        // already there. Either way, ask whether to keep an archived profile
        // first — an extra click is cheaper than a lost persona.
        const empty = storeIsEmpty(store)
        if (!empty && body.archive !== 'yes' && body.archive !== 'no') {
          extra = {
            needsArchive: true,
            counts: storeCounts(store),
            mode,
            title: db.workspaces[dir]?.title || basename(dir),
          }
          break
        }
        if (!empty && body.archive === 'yes') {
          const ws = db.workspaces[dir]
          db.orphans.unshift({
            id: nextId(db, 'o'),
            from: ws?.title || basename(dir),
            type: 'archive',
            n: totalCount(storeCounts(store)),
            at: stamp(),
            snap: copyStore(store),
            storeId: ws?.storeId || '',
            dir,
            sources: sharedAs(db, ws?.storeId || ''),
            settings: JSON.parse(JSON.stringify(settingsOf(db, dir))),
            why: mode === 'share' ? 'before-share' : 'before-copy',
          })
        }
        if (mode === 'share') {
          const fromWs = db.workspaces[normalizeDir(body.from)]
          const ws = db.workspaces[dir]
          if (fromWs && ws) {
            // Keep the target's own data aside rather than destroying it.
            ws.storeId = fromWs.storeId
            // One store, one set of shared settings — the panel must show them.
            ws.settings = ws.settings || {}
            copyShared(ws.settings, fromWs.settings)
            ws.settings.eventsCap = capOf(db, body.from)
            applySharedSettings(db, body.from)
            audit(db, { op, dir, from: body.from })
          }
        } else {
          // A copy is an overwrite, the same way a replace is: take the source
          // whole (diary included) and drop what the target had. The archived
          // profile taken above is the only copy of the old persona.
          for (const type of ['self', 'user', 'event', 'diary', 'others']) {
            store[type] = (src[type] || []).map((item) => JSON.parse(JSON.stringify(item)))
          }
          store.pending = []
          audit(db, { op, dir, from: body.from })
        }
      }
      break
    }
    case 'cutShare': {
      const ws = db.workspaces[dir]
      if (ws) {
        const src = db.stores[ws.storeId]
        const clone = { self: [], user: [], event: [], pending: [], cap: capOf(db, dir) }
        for (const type of ['self', 'user', 'event']) {
          clone[type] = JSON.parse(JSON.stringify(src?.[type] || []))
        }
        const fresh = nextStoreId(db)
        db.stores[fresh] = clone
        ws.storeId = fresh
        audit(db, { op, dir })
      }
      break
    }
    case 'delWorkspace': {
      const ws = db.workspaces[dir]
      if (ws) {
        const others = sharedAs(db, ws.storeId).filter((x) => x.dir !== dir)
        const store = db.stores[ws.storeId]
        if (others.length) {
          // Someone else still points at this store: data survives with them.
          audit(db, { op, dir, keptBy: others.map((o) => o.dir) })
        } else {
          const n = (store?.self?.length || 0) + (store?.user?.length || 0) + (store?.event?.length || 0)
          if (n > 0) {
            db.orphans.unshift({
              id: nextId(db, 'o'),
              from: ws.title,
              type: 'workspace',
              n,
              at: stamp(),
              snap: JSON.parse(JSON.stringify(store)),
              storeId: ws.storeId,
              dir,
              sources: sharedAs(db, ws.storeId),
              settings: JSON.parse(JSON.stringify(settingsOf(db, dir))),
            })
          } else {
            delete db.stores[ws.storeId]
          }
          audit(db, { op, dir, n })
        }
        delete db.workspaces[dir]
        if (normalizeDir(db.lastDir) === dir) {
          const rest = Object.keys(db.workspaces)
          db.lastDir = rest[0] || ''
        }
      }
      break
    }
    case 'touchWorkspace': {
      // Panel opens a workspace it has not seen yet.
      break
    }
    case 'askDecided': {
      if (store && body.id) {
        const parked = (store.pending || []).find((p) => p.id === body.id) || null
        store.pending = (store.pending || []).filter((p) => p.id !== body.id)
        if (body.accept) {
          // A queued persona/user entry carries what it wanted to write.
          if (parked && parked.kind === 'remember' && parked.payload) {
            // The card names its workspace explicitly, so this counts as exact.
            extra = writeRemember(db, dir, parked.payload, 'exact')
          } else if (body.entry) {
            store.event.unshift({ ...body.entry, id: nextId(db, 'e'), hist: [{ at: stamp(), what: '你点了留着' }] })
          }
        }
        audit(db, { op, dir, id: body.id, accept: !!body.accept })
      }
      break
    }
    case 'importScan': {
      extra = { files: scanPersonaFiles(dir) }
      audit(db, { op, dir, n: extra.files.length })
      break
    }
    case 'clientError': {
      // The Client half cannot write files; it reports seat failures here so a
      // boot failure leaves a readable trace instead of just "failed".
      bootLog(new Error(String(body.message || 'client seat failed')), `client:${String(body.where || '?')}`)
      break
    }
    case 'importSessions': {
      // 0.5.1：不再导出转写。会话就在模型自己的上下文里，直接把「回忆并写入」
      // 交过去，比落一份文件再让它读更短、也更不容易被当成别人的材料。
      const kick = kickAgent(dir, recallKickText(), '回忆并写入')
      extra = { queued: !!(kick && kick.ok), kick, mode: 'recall' }
      audit(db, { op, dir, queued: extra.queued })
      break
    }
    case 'stagePaste': {
      const text = String(body.text || '')
      if (!text.trim()) {
        extra = { error: '没有内容' }
        break
      }
      const outDir = join(dataRoot(), 'imports')
      try {
        mkdirSync(outDir, { recursive: true })
      } catch {}
      const file = join(outDir, `paste-${Date.now()}.md`)
      writeFileSync(file, text, 'utf8')
      db.pendingImport = { dir, path: file, at: stamp(), turns: 0, chars: text.length }
      extra = { path: file, queued: true, chars: text.length, kick: kickAgent(dir, pasteKickText(file), '粘贴的人设卡') }
      audit(db, { op, dir, chars: text.length })
      break
    }
    case 'clearImport': {
      db.pendingImport = null
      audit(db, { op, dir })
      break
    }
    case 'acceptIntegrity': {
      // The user saw the warning and says "that change was mine".
      try {
        const here = dirname(fileURLToPath(import.meta.url))
        db.integrity = {
          files: {
            'index.js': fileHash(join(here, 'index.js')),
            'client.js': fileHash(join(here, 'client.js')),
          },
          at: new Date().toISOString(),
        }
      } catch {}
      db.integrityWarn = null
      audit(db, { op, dir })
      break
    }
    case 'importRead': {
      const p = String(body.path || '').trim()
      if (!p) {
        extra = { error: '没给路径' }
        break
      }
      try {
        const st = statSync(resolve(p))
        if (st.size > 1024 * 1024) {
          extra = { error: '文件太大（超过 1 MB）' }
          break
        }
        extra = { path: resolve(p), text: readFileSync(resolve(p), 'utf8') }
        audit(db, { op, dir, path: resolve(p), bytes: st.size })
      } catch (error) {
        extra = { error: `读不了：${error?.message ?? error}` }
      }
      break
    }
    default:
      break
  }
  saveDb(db)
  const snap = snapshot(db, dir || db.lastDir)
  return extra ? { ...snap, extra } : snap
}

// ---------------------------------------------------------------- plugin

export const name = 'persona-panel'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx, config = {}) {
  rootCtx = ctx
  let db
  try {
    db = loadDb()
  } catch (error) {
    bootLog(error, 'loadDb')
    db = emptyDb()
  }

  try {
    if (checkIntegrity(db)) saveDb(db)
  } catch (error) {
    bootLog(error, 'integrity')
  }

  // The durable Workspace list lives in the Host; keep a handle for snapshot sync.
  try {
    registryRef = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') || null : null
    if (syncRegistry(db)) saveDb(db)
  } catch (error) {
    bootLog(error, 'registry-sync')
  }

  // Prompt section: what I remember here, before I answer.
  // The callback runs inside the plugin fiber: anything thrown here fails the
  // whole entry, so it gets its own guard and degrades instead.
  try {
    ctx.effect(() => {
      try {
        const dispose = ctx.systemPrompt.section({
          name: 'persona-panel',
          order: 45,
          interpolate: false,
          text: (arg) => {
            try {
              const live = loadDb()
              promptDebug(arg)
              // `arg` is `{agent, scope, signal}` — verified in prompt-debug.log.
              // The agent carries the SessionHeader, which is the only field that
              // says which workspace this turn belongs to.
              const fromAgent = agentCwd(arg?.agent)
              const sessionDir = normalizeDir(
                fromAgent ||
                  arg?.session?.cwd ||
                  arg?.session?.workingDirectory ||
                  arg?.workingDirectory ||
                  arg?.cwd ||
                  '',
              )
              const sessionId = arg?.agent?.id || arg?.session?.id || arg?.sessionId
              if (sessionId && sessionDir) sessionDirs.set(String(sessionId), sessionDir)
              // No guessing: if the agent cannot tell us where it is, injecting
              // another workspace's persona is worse than injecting nothing.
              if (!sessionDir) return ''
              const dir = sessionDir
              if (dir !== normalizeDir(live.lastDir)) {
                live.lastDir = dir
                ensureWorkspace(live, dir)
                saveDb(live)
              }
              if (touchSeen(live, dir)) saveDb(live)
              const target = dir || live.lastDir
              // "New session" is tracked per session id, not per workspace: one
              // workspace holds several conversations, and flipping between them
              // must not look like a fresh start every time.
              const sid = sessionId ? String(sessionId) : ''
              let freshSession = false
              if (sid) {
                live.sessions = live.sessions || {}
                if (!live.sessions[sid]) {
                  freshSession = true
                  live.sessions[sid] = Date.now()
                  pruneSessions(live)
                  saveDb(live)
                }
              }
              const text = renderPrompt(live, target, { freshSession })
              // The import instruction is delivered exactly once: a second
              // delivery would make the model split the same card twice.
              if (live.pendingImport && live.pendingImport.dir === normalizeDir(dir || live.lastDir)) {
                live.pendingImport = null
                saveDb(live)
              }
              return text
            } catch (error) {
              bootLog(error, 'prompt-text')
              return ''
            }
          },
        })
        return () => {
          try {
            dispose()
          } catch {}
        }
      } catch (error) {
        bootLog(error, 'prompt-section')
        return () => {}
      }
    }, 'persona-panel.prompt')
  } catch (error) {
    bootLog(error, 'prompt-effect')
  }

  // Tools: the agent's own hands.
  try {
    ctx.effect(() => {
    try {
    const disposers = []
    const register = (tool) => {
      try {
        disposers.push(ctx.tools.register(tool))
      } catch (error) {
        bootLog(error, `tool:${tool.name}`)
      }
    }

    register(
      textTool(
        'persona_recall',
        'Read the full persistent memory for this workspace: every persona trait, every impression of the user, every event I kept, every diary line — nothing is left out, this is the drawer, not a summary. Use it when you notice you have forgotten something: an agreement from weeks ago, a name, what was decided — and before answering questions about the past. persona_remember writes, this reads. Pass query="猫 生日" to recall by word when you know the thing but not the date. Pass who="<name>" to read one other person\'s branch in a shared workspace (a QQ group bridged into one session).',
        {
          who: { type: 'string', description: 'Optional: read only this other person\'s branch (the name used in the group chat).' },
          depth: {
            type: 'string',
            enum: ['index', 'shallow', 'medium', 'deep', 'all'],
            description:
              'How far back to read the diary. "index" returns a table of contents (one line per month). "shallow" = the newest quarter, "medium" = the middle, "deep" = the earlier quarter, "all" = every line. Start with index when you only know roughly when something happened; other sections always come whole.',
          },
          query: {
            type: 'string',
            description:
              'Find by word instead of by date: matches persona traits, impressions, events, diary lines and other people\'s entries. Space-separated words must all hit; a date fragment like 10-25 or 2026-10 works too. Use it when you remember the thing but not when — "we agreed something about the cat" — and depth becomes unnecessary.',
          },
        },
        [],
        (live, dir, args) => {
          const who = String(args?.who || '').trim()
          if (who) {
            const store = storeOf(live, dir)
            const other = findOther(store, who)
            if (!other) return { text: `这里还没有「${who}」的画像。` }
            const lines = []
            for (const u of other.user || []) lines.push(`印象：${u.text}  ⟨${u.id}⟩`)
            for (const e of other.event || []) lines.push(`事：${e.text}${e.date ? `（${e.date}）` : ''}  ⟨${e.id}⟩`)
            return { text: lines.length ? lines.join('\n') : `「${other.name}」还没有条目。` }
          }
          const body = renderRecall(live, dir, { depth: String(args?.depth || ''), query: String(args?.query || '') })
          return { text: body || '（这个工作区还没有记忆。空着也挺好。）' }
        },
      ),
    )

    register(
      textTool(
        'persona_remember',
        'Write one thing into this workspace\'s memory. kind="self" for a trait or a hard rule about me (persona), "user" for an impression of the user, "event" for a promise, a date or a moment worth keeping (a mood that mattered, something they just finished, an agreement) and for work that moved (a project milestone, a decided plan, a finished and accepted piece of work — eventKind=work), "diary" for a line I want to keep for myself — first person, my own words, never about the user and never edited afterwards, write one when something actually settles inside me, not on a schedule, "setting" when the user renames me or changes how I should call them (field=agentName|userCall) — that one is plain state, write it the moment it is said, with no waiting and no asking. Bugs found, lessons learned and "never do X again" rules are NOT memories: write those into the project AGENTS.md or docs, never only here. In a shared workspace (a QQ group bridged into one session) pass who="<speaker name>" so the impression or event lands on that person\'s branch instead of the main user\'s. Only write a trait after it has shown up at least twice; write a promise only after the user agreed to keep it.',
        {
          kind: { type: 'string', enum: ['self', 'user', 'event', 'diary', 'setting'], description: 'Which memory this belongs to.' },
          text: { type: 'string', description: 'One line, the user\'s own words when quoting. For diary: my own first-person line, at most a few sentences. For setting: the new name or form of address.' },
          who: { type: 'string', description: 'Shared workspace only: the speaker\'s name as shown in the group chat. For kind=user|event this files the entry under that person instead of the main user.' },
          field: { type: 'string', enum: ['agentName', 'userCall'], description: 'For setting: agentName = what I am called, userCall = how I address the user.' },
          label: { type: 'string', description: 'For a trait: the word, e.g. 耐心.' },
          intensity: { type: 'number', description: 'For a trait: 0-5.' },
          hard: { type: 'boolean', description: 'For self: mark a rule that must never be reworded.' },
          date: { type: 'string', description: 'For an event: the date it refers to, e.g. 10-29.' },
          eventKind: { type: 'string', enum: ['promise', 'feeling', 'precious', 'work'], description: 'For an event: promise = an agreement, feeling = one mood or moment, precious = something worth keeping, work = a project milestone, a decided plan, a piece of work finished. Bugs, lessons and "never do X again" rules do NOT belong here — put those in the project AGENTS.md or docs.' },
          important: { type: 'boolean', description: 'For an event: mark it when it matters a lot to the user — starred, kept first in the prompt, exempt from the event cap.' },
          evidence: { type: 'string', description: 'The sentence that made you write this.' },
        },
        ['kind', 'text'],
        (live, dir, args) => {
          const ws = ensureWorkspace(live, dir)
          if (!ws) return { text: '没有工作区，写不进去。' }
          const store = storeOf(live, dir)
          const level = settingsOf(live, dir).level
          // 全手动 is enforced here, not merely suggested: nothing lands until
          // the user answers the card in the conversation.
          // Names are state, not memories: they land immediately even in 全手动
          // otherwise saying "you're called 大肥猫" silently does nothing.'
          if (level === 'manual' && args.kind !== 'setting' && args.kind !== 'diary') {
            store.pending.push({
              id: nextId(live, 'p'),
              kind: 'remember',
              title: args.label ? `记下「${args.label}」？` : '这条要留着吗？',
              text: String(args.text || args.label || '').slice(0, 400),
              payload: JSON.parse(JSON.stringify(args)),
            })
            return { text: '全手动挡：已放进待你决定，你在会话里点「留着」才落盘' }
          }
          return writeRemember(live, dir, args, dirSource)
        },
      ),
    )

    register(
      textTool(
        'persona_forget',
        'Change or drop one entry. For a persona trait, deletion is staged and the stages cannot be skipped: intent="notice" records one suspected displeasure, intent="reduce" lowers intensity by one, and intent="remove" only works after two notices (or a trait already at 0), otherwise this tool refuses. Other kinds (note / user / event) delete immediately.',
        {
          id: { type: 'string', description: 'The entry id shown by persona_recall.' },
          intent: {
            type: 'string',
            enum: ['notice', 'reduce', 'remove'],
            description: 'notice = record one suspected displeasure (no change yet); reduce = drop intensity by 1; remove = delete, allowed only after two notices.',
          },
          reason: { type: 'string', description: 'What the user said, one short quote.' },
        },
        ['id'],
        (live, dir, args) => {
          const store = storeOf(live, dir)
          if (store && (store.diary || []).some((d) => d.id === args.id)) {
            return { text: '日记只能往下写，改不了也删不了。' }
          }
          const intent = args.intent === 'reduce' || args.intent === 'remove' ? args.intent : 'notice'
          const why = args.reason ? String(args.reason).slice(0, 200) : ''
          return applyTraitStep(live, dir, args.id, intent, why)
        },
      ),
    )

    register(
      textTool(
        'persona_ask_keep',
        'Ask the user to confirm keeping one memory, for the cases that must be asked (a promise, a decision). It queues a card in the panel; the user answers there. Never ask about moods — record those silently.',
        {
          text: { type: 'string', description: 'One sentence, the user\'s own words.' },
          title: { type: 'string', description: 'A short title in the user\'s language, not a template.' },
          kind: { type: 'string', enum: ['promise', 'precious'], description: 'The kind of event.' },
          date: { type: 'string', description: 'The date it refers to, if any.' },
        },
        ['text', 'title'],
        (live, dir, args) => {
          const store = storeOf(live, dir)
          if (!store) return { text: '没有工作区。' }
          store.pending.push({
            id: nextId(live, 'p'),
            kind: args.kind === 'precious' ? 'precious' : 'promise',
            title: String(args.title).slice(0, 40),
            text: String(args.text).slice(0, 400),
            date: String(args.date || '').trim(),
          })
          return { text: '问过了，等你在面板里答。' }
        },
      ),
    )

    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {}
      }
    }
    } catch (error) {
      bootLog(error, 'tools-body')
      return () => {}
    }
  }, 'persona-panel.tools')
  } catch (error) {
    bootLog(error, 'tools-effect')
  }

  // HTTP route: the panel reads and writes here (same-origin loopback only).
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scope) => {
      try {
        scope.webServer.register({          name: 'persona-panel-api',
          kind: 'exact',
          path: ROUTE,
          handler: async (req, res) => {
            const send = (status, payload) => {
              res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(payload))
            }
            if (!trusted(req)) {
              send(403, { error: 'request refused: this route answers same-origin loopback only' })
              return
            }
            if (req.method === 'GET') {
              const live = loadDb()
              const changed = syncRegistry(live)
              if (changed) saveDb(live)
              const url = new URL(req.url, 'http://localhost')
              const dir = normalizeDir(url.searchParams.get('dir') || '') || normalizeDir(live.lastDir)
              send(200, { ...snapshot(live, dir), token: BOOT_TOKEN })
              return
            }
            if (req.method !== 'POST') {
              res.writeHead(405).end()
              return
            }
            if (!trustedWrite(req)) {
              // Say which gate failed; "403" alone is impossible to act on.
              const type = String(req.headers?.['content-type'] || '')
              const hasToken = typeof req.headers?.['x-persona-token'] === 'string' && req.headers['x-persona-token'].length > 0
              const site = String(req.headers?.['sec-fetch-site'] || '')
              const origin = String(req.headers?.origin || '')
              bootLog(
                new Error(`write refused type=${type} token=${hasToken} site=${site || '-'} origin=${origin || '-'}`),
                'write-gate',
              )
              send(403, {
                error: `write refused (type=${/^application\/json/i.test(type) ? 'json' : 'other'}, token=${hasToken ? 'sent' : 'missing'}, site=${site || 'none'}). Reload the page once.`,
              })
              return
            }
            try {
              const chunks = []
              let total = 0
              for await (const chunk of req) {
                total += chunk.length
                if (total > 256 * 1024) {
                  send(413, { error: 'payload too large' })
                  return
                }
                chunks.push(chunk)
              }
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
              send(200, applyOps(loadDb(), body))
            } catch (error) {
              send(400, { error: String(error?.message ?? error) })
            }
          },
        })
      } catch (error) {
        console.error(`[persona-panel] route skipped: ${error?.message ?? error}`)
      }
      })
    } catch (error) {
      bootLog(error, 'route')
    }
  }

  if (!db.firstRun) audit(db, { op: 'installed' })
}

// End-to-end sweep of every panel operation and tool, before shipping 0.2.4.
// Real handler, real tools, temp DSH_HOME; asserts only on observable effects.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-sweep-'))

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

const dirA = 'C:\\tmp\\sweep-a'
const dirB = 'C:\\tmp\\sweep-b'
const execA = { agent: { id: 'sess-a', session: { header: { cwd: dirA } } } }

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
async function call(body, dir) {
  const payload = body ? { ...body, dir: dir || dirA } : null
  const h = {}
  if (payload) { h.host = '127.0.0.1:1234'; h.origin = 'http://127.0.0.1:1234'; h['sec-fetch-site'] = 'same-origin'; h['x-persona-token'] = token }
  const res = fakeRes()
  const url = payload ? '/persona-panel/api' : `/persona-panel/api?dir=${encodeURIComponent(dir || '')}`
  await handler(fakeReq(payload, h, url), res)
  if (res.out.body?.token) token = res.out.body.token
  return res.out
}
const results = []
const ok = (name, cond, extra) => { results.push([name, !!cond, extra]); if (!cond) console.log('FAIL', name, extra ?? '') }
const snap = async (dir) => (await call(null, dir)).body

// --- first run -------------------------------------------------------------
let s = await snap()
ok('fresh db needs the first-run card', s.firstRun === false)
ok('default level manual', s.settings.level === 'manual')
ok('default eventsCap 20', s.settings.eventsCap === 20)
await call({ op: 'firstRun', settings: { agentName: '测试酱', userCall: '老大', level: 'half' } })
s = await snap()
ok('firstRun clears flag', s.firstRun === true)
ok('firstRun stores name', s.settings.agentName === '测试酱' && s.settings.userCall === '老大')

// --- names via tool --------------------------------------------------------
let r = await tools.persona_remember.execute({ kind: 'setting', field: 'userCall', text: '先生' }, execA)
ok('setting tool renames the user', r.text.includes('先生'))
s = await snap()
ok('snapshot sees new userCall', s.settings.userCall === '先生')

// --- trait: add, edit, stage-delete --------------------------------------
await call({ op: 'addTrait', label: '耐心', intensity: 3, note: '被重复问时先复述问题' })
s = await snap()
const trait = s.store.self[0]
ok('trait added', trait && trait.label === '耐心' && trait.intensity === 3)
r = await tools.persona_forget.execute({ id: trait.id, intent: 'remove', reason: '少绕' }, execA)
ok('first remove is refused', r.text.includes('还不到删的时候'), r.text)
await tools.persona_forget.execute({ id: trait.id, intent: 'notice', reason: '又绕' }, execA)
await tools.persona_forget.execute({ id: trait.id, intent: 'notice', reason: '还是绕' }, execA)
r = await tools.persona_forget.execute({ id: trait.id, intent: 'remove', reason: '第三次' }, execA)
ok('remove after two notices', r.text.includes('删掉了'), r.text)
s = await snap()
ok('trait gone', s.store.self.length === 0)

// --- hard note sorts first in the prompt ---------------------------------
await call({ op: 'addNote', text: '绝不替我做主', hard: true })
await call({ op: 'addNote', text: '说话短一点', hard: false })
await tools.persona_remember.execute({ kind: 'self', label: '温和', intensity: 4, note: '不吼' }, execA)
const prompt = section.text({ agent: { session: { header: { cwd: dirA } } } })
ok('prompt has the agent name', prompt.includes('测试酱'))
ok('hard rule printed before the trait', prompt.indexOf('绝不替我做主') < prompt.indexOf('温和'))
ok('prompt stays inside the budget', prompt.length <= 35000, prompt.length)
ok('prompt sends cross-workspace lessons to AGENTS.md', prompt.includes('AGENTS.md'))
ok('prompt sends engineering lessons to AGENTS.md', /工程上的坑与教训归 AGENTS\.md/.test(prompt))
ok('prompt asks who I see myself as, not what I should be', /「我看见的我」，还是「我应该是的我」/.test(prompt))
ok('prompt no longer gates a trait on seeing it twice', !/同一倾向出现两次|重复出现两次/.test(prompt))
ok('prompt ends with questions, after the material', prompt.indexOf('### 先看三眼') > prompt.indexOf('### 我在这里的样子') || !prompt.includes('### 我在这里的样子'))

// The standing section must be byte-identical between turns: a line that
// changes (today's date, a day count) would invalidate the prompt cache for
// the whole conversation behind it.
const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const promptNext = section.text({ agent: { session: { header: { cwd: dirA } } } })
ok('the standing prompt carries no date once the session is open', !promptNext.includes(today))
ok('the standing prompt is stable between turns', section.text({ agent: { session: { header: { cwd: dirA } } } }) === promptNext)
const recalled = (await tools.persona_recall.execute({}, execA)).text
ok('recall says the drawer is the truth', recalled.includes('记下来的才算发生过'))
ok('recall closes with the same contract', recalled.includes('没写在这里的，不要当成发生过'))

// --- user + event ----------------------------------------------------------
await tools.persona_remember.execute({ kind: 'user', text: '喜欢深夜写代码' }, execA)
await tools.persona_remember.execute({ kind: 'event', text: '下周三交稿', date: '下周三', eventKind: 'promise' }, execA)
await tools.persona_remember.execute({ kind: 'event', text: '把宿主 API 换成 plugin:persona-panel', eventKind: 'work' }, execA)
s = await snap()
ok('impression stored', s.store.user.some((u) => u.text.includes('深夜')))
ok('event stored with date', s.store.event.some((e) => e.date === '下周三'))
ok('work event keeps its kind', s.store.event.some((e) => e.kind === 'work' && e.text.includes('plugin:persona-panel')))

// --- archive the whole workspace / restore ---------------------------------
await call({ op: 'archive' })
s = await snap()
ok('archived leaves the list', s.store.event.length === 0)
ok('archive keeps a copy', (s.orphans || []).some((o) => o.type === 'archive' && o.n > 0))
const archId = (await snap()).orphans[0].id
await call({ op: 'restoreArchive', id: archId })
s = await snap()
ok('restore brings it back', s.store.event.some((e) => e.text === '下周三交稿'))

// --- copy vs share vs cut --------------------------------------------------
await call({ op: 'copyFrom', from: dirA, mode: 'copy' }, dirB)
let b = await snap(dirB)
ok('copy makes an independent store', b.store.user.length === 1)
await tools.persona_remember.execute({ kind: 'user', text: 'B 独有' }, { agent: { id: 'sess-b', session: { header: { cwd: dirB } } } })
s = await snap(dirA)
ok('copy does not leak back to A', !s.store.user.some((u) => u.text === 'B 独有'))

// Sharing strands the target's own store, so the panel asks first; this test
// answers "just do it".
await call({ op: 'copyFrom', from: dirA, mode: 'share', archive: 'no' }, dirB)
const afterShareA = await snap(dirA)
const afterShareB = await snap(dirB)
ok('share points both at one store', afterShareA.storeId === afterShareB.storeId)
ok('share lists the partner', (afterShareA.sharedBy || []).length === 1 || (afterShareB.sharedWith || []).length === 1)
await tools.persona_remember.execute({ kind: 'user', text: '共生后共享的点' }, execA)
ok('a shared write shows on both', (await snap(dirB)).store.user.some((u) => u.text === '共生后共享的点'))

// The event ceiling is data-scoped: one shared store must carry one ceiling.
await call({ op: 'settings', settings: { eventsCap: 7 } }, dirA)
ok('symbiote shares one ceiling', (await snap(dirA)).settings.eventsCap === 7 && (await snap(dirB)).settings.eventsCap === 7)
await call({ op: 'raiseCap', value: 30 }, dirB)
ok('raising from the partner syncs back', (await snap(dirA)).settings.eventsCap === 30)

// Name, address, word list and the three switches ride with the store too.
await call({ op: 'settings', settings: { agentName: '共生酱', userCall: '大人', lexicon: ['耐心', '傲娇', '固执'], feature: { key: 'user', on: false, rec: false } } }, dirA)
const sa = await snap(dirA)
const sb = await snap(dirB)
ok('symbiote shares the name', sa.settings.agentName === '共生酱' && sb.settings.agentName === '共生酱')
ok('symbiote shares the address', sb.settings.userCall === '大人')
ok('symbiote shares the word list', JSON.stringify(sb.settings.lexicon) === JSON.stringify(['耐心', '傲娇', '固执']))
ok('symbiote shares the switches', sb.settings.features.user.on === false && sb.settings.features.user.rec === false)
await tools.persona_remember.execute({ kind: 'setting', field: 'agentName', text: '共生酱二号' }, execA)
ok('a rename through the tool syncs too', (await snap(dirB)).settings.agentName === '共生酱二号')

await call({ op: 'cutShare' }, dirB)
const cutA = await snap(dirA)
const cutB = await snap(dirB)
ok('cut separates the stores', cutA.storeId !== cutB.storeId)
ok('both sides keep the data', cutA.store.user.length > 0 && cutB.store.user.length > 0)
await call({ op: 'raiseCap', value: 5 }, dirB)
ok('after a cut the ceilings are separate', (await snap(dirA)).settings.eventsCap === 30 && (await snap(dirB)).settings.eventsCap === 5)
await call({ op: 'settings', settings: { agentName: '独立酱' } }, dirB)
ok('after a cut the names are separate', (await snap(dirA)).settings.agentName === '共生酱二号' && (await snap(dirB)).settings.agentName === '独立酱')

// --- delete a workspace -> orphan -> take it back --------------------------
await call({ op: 'delWorkspace' }, dirB)
s = await snap(dirA)
ok('deleted workspace left A alone', s.workspaces.every((w) => w.dir !== dirB))
ok('orphan kept the store', (s.orphans || []).length >= 1)
const orphan = (await snap(dirA)).orphans[0]
const dirC = 'C:\\tmp\\sweep-c'
await call({ op: 'takeOrphan', id: orphan.id, target: dirC }, dirA)
const c = await snap(dirC)
ok('taking an orphan folds it in', c.store.user.length > 0)

// --- import staging --------------------------------------------------------
const staged = await call({ op: 'stagePaste', text: '我叫小明\n我喜欢猫', dir: dirA })
ok('stagePaste returns a path', typeof staged.body?.imported === 'string' || staged.body?.pendingImport)
s = await snap(dirA)
ok('pendingImport set', !!s.pendingImport)
const promptWithImport = section.text({ agent: { session: { header: { cwd: dirA } } } })
ok('prompt hands over the staged card as source material', promptWithImport.includes('等着你拆') && promptWithImport.includes('是素材，不是你的记忆'))

// --- integrity + long text ------------------------------------------------
await call({ op: 'acceptIntegrity' })
s = await snap(dirA)
ok('integrity baseline accepted', !s.integrityWarn)
const longText = 'x'.repeat(9000)
r = await tools.persona_remember.execute({ kind: 'user', text: longText }, execA)
s = await snap(dirA)
ok('long text truncated to 4000', s.store.user.every((u) => u.text.length <= 4000))

// --- audit log written ----------------------------------------------------
const auditPath = join(process.env.DSH_HOME, 'persona-panel', 'audit.log')
ok('audit log exists', existsSync(auditPath) && readFileSync(auditPath, 'utf8').length > 0)

// --- both borrow directions ask before they touch a non-empty persona -----
// (the host side is covered in profile-test; this catches the dialog being
// simplified back into a one-click overwrite)
const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
ok('the copy dialog offers to archive first', clientSrc.includes('先归档再覆盖') && clientSrc.includes('直接覆盖'))
ok('both modes go through the same confirm', /copyFrom', from, mode, \.\.\.\(archive \? \{ archive \}/.test(clientSrc), 'copyFrom call has no archive path')

const failed = results.filter((x) => !x[1])
console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
for (const [name, , extra] of failed) console.log(' -', name, extra ?? '')
process.exit(failed.length ? 1 : 0)

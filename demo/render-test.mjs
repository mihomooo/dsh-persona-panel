// Render smoke for client.js without a browser: a tiny hook-capable React shim,
// a fetch stub that serves one fixture, and assertions that every component
// renders without throwing. Catches the "data.something is undefined" class of
// bug before a restart.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// ---- React shim -----------------------------------------------------------
let dirty = false
let current = null
const bags = new Map()
const effects = []
function useState(init) {
  const bag = current.bag
  const i = current.i++
  if (!(i in bag.vals)) bag.vals[i] = typeof init === 'function' ? init() : init
  const set = (v) => {
    bag.vals[i] = typeof v === 'function' ? v(bag.vals[i]) : v
    dirty = true
  }
  return [bag.vals[i], set]
}
function useEffect(fn) { effects.push(fn); return undefined }
function useMemo(fn) { return fn() }
function useCallback(fn) { return fn }
function useRef(v) { return { current: v } }
function createElement(type, props, ...kids) {
  return { type, props: props || {}, kids }
}
function flatten(node, out) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out }
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  const { type, props, kids } = node
  if (typeof type === 'function') {
    const bag = { vals: (props.__bag && props.__bag.vals) || [] }
    const id = type.name || 'anon'
    const key = `${id}`
    const prev = current
    const bagRef = bags.get(key) || bag
    bags.set(key, bagRef)
    current = { i: 0, bag: bagRef }
    let rendered
    try { rendered = type({ ...props, __bag: undefined }) } finally { current = prev }
    flatten(rendered, out)
    return out
  }
  for (const k of kids) flatten(k, out)
  if (props && props.children) flatten(props.children, out)
  return out
}
const React = { createElement, Fragment: Symbol('f'), useState, useEffect, useMemo, useCallback, useRef, useRef2: undefined }

// ---- fetch stub -----------------------------------------------------------
const fixture = {
  dir: 'C:\\Users\\me\\Desktop\\ds',
  title: 'ds',
  storeId: 's1',
  sharedBy: [],
  sharedWith: 1,
  store: {
    self: [
      { id: 't1', kind: 'trait', label: '耐心', intensity: 4, note: '被重复问时先复述问题', ev: [], hist: [{ at: '现在', what: '记下了' }] },
      { id: 'n1', kind: 'note', text: '绝不替我做主', hard: true, ev: [], hist: [] },
    ],
    user: [{ id: 'u1', text: '喜欢深夜写代码', ev: [] }],
    event: [{ id: 'e1', kind: 'feeling', text: '完成了一件做了很久的事', date: '今天', status: 'open', important: true, ev: [], hist: [] }],
    pending: [
      { id: 'p1', kind: 'capFull', text: '第四条事件', date: '', eventKind: 'feeling', important: false, capCount: 20, capLimit: 20, ev: [], hist: [] },
    ],
    others: [{ id: 'o1', name: '小缘', aliases: ['缘缘'], user: [{ id: 'ou1', text: '在群里发猫图' }], event: [] }],
  },
  settings: {
    level: 'half',
    features: { self: { on: true, rec: true }, user: { on: true, rec: true }, event: { on: true, rec: true }, others: { on: true, rec: true } },
    lexicon: ['耐心', '傲娇'],
    agentName: '测试酱',
    userCall: '老大',
    eventsCap: 20,
  },
  firstRun: true,
  workspaces: [{ dir: 'C:\\Users\\me\\Desktop\\ds', title: 'ds', lastSeen: 1, counts: { self: 3, user: 1, event: 2, diary: 4 } }],
  orphans: [{ id: 'o9', from: 'ds', type: 'archive', n: 3, at: '昨天', dir: 'C:\\Users\\me\\Desktop\\ds', storeId: 's1' }],
  profiles: [
    {
      id: 'live:s1',
      kind: 'live',
      name: 'ds',
      sources: [{ dir: 'C:\\Users\\me\\Desktop\\ds', title: 'ds' }],
      src: '来自「ds」',
      counts: { self: 3, user: 1, event: 2, diary: 4, others: 1 },
      total: 11,
      archived: false,
      at: '',
    },
    {
      id: 'o9',
      kind: 'orphan',
      name: '旧人格',
      sources: [{ dir: 'C:\\Users\\me\\Desktop\\ds', title: 'ds' }],
      src: '来自「ds」',
      counts: { self: 2, user: 1, event: 0, diary: 0, others: 0 },
      total: 3,
      archived: true,
      at: '昨天',
    },
  ],
  pendingImport: null,
  integrityWarn: null,
  token: 'abc',
}

globalThis.fetch = async (url, opts) => {
  if (opts && opts.method === 'POST') return { ok: true, status: 200, json: async () => fixture }
  return { ok: true, status: 200, json: async () => fixture }
}
globalThis.window = globalThis
globalThis.document = { head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), querySelector: () => null }

// ---- load the module ------------------------------------------------------
let registration = null
const loading = { load: (mod) => { registration = mod } }
globalThis.__ModuleLoader__ = loading
const body = source.replace('window.__ModuleLoader__.load(', '__load(')
const factory = new Function('window', 'require', 'hook', '__load', `${body}; return hook.loaded`)
const modules = { react: React }
factory(globalThis, (name) => modules[name] || React, { loaded: null }, (mod) => { registration = mod })

if (!registration) { console.error('module did not register'); process.exit(1) }
const slots = {}
const ctx = {
  slots: {
    inject: (name, cb) => { try { cb() } catch (e) { console.log('inject failed', name, e.message) } },
    register: (opts, Comp) => { slots[opts.name] = slots[opts.name] || []; slots[opts.name].push({ ...opts, component: Comp || opts.component }) },
  },
  get: () => null,
  effect: (fn) => fn(),
}

let plugin = null
try { plugin = registration.factory((name) => modules[name] || React) } catch (e) { console.log('factory threw:', e.message); process.exit(1) }
try { plugin.apply(ctx) } catch (e) { console.log('apply threw:', e.message) }

// Expand a tree, invoking function components, so the test can click what a
// person would click instead of only matching strings in the source.
function expand(node) {
  if (node === null || node === undefined || node === false || node === true) return []
  if (Array.isArray(node)) return node.flatMap(expand)
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  const { type, props, kids } = node
  if (typeof type === 'function') {
    const key = type.name || 'anon'
    const bagRef = bags.get(key) || { vals: [] }
    bags.set(key, bagRef)
    const prev = current
    current = { i: 0, bag: bagRef }
    let out
    try { out = type({ ...props, __bag: undefined }) } finally { current = prev }
    return expand(out)
  }
  const children = (kids || []).flatMap(expand).concat(props && props.children ? expand(props.children) : [])
  return [{ type, props, children }]
}
const textOf = (nodes) => nodes.map((n) => (typeof n === 'string' ? n : textOf(n.children || []))).join(' ')
const findNode = (nodes, pred) => {
  for (const n of nodes) {
    if (typeof n === 'string') continue
    if (pred(n)) return n
    const hit = findNode(n.children || [], pred)
    if (hit) return hit
  }
  return null
}

const results = []
const ok = (name, cond, extra) => { results.push([name, !!cond, extra]); if (!cond) console.log('FAIL', name, extra ?? '') }

for (const [name, defs] of Object.entries(slots)) ok(`slot ${name} registered`, defs.length > 0)

// Mount the panel through the settings slot and the main slot.
const renderTargets = Object.entries(slots).map(([name, defs]) => [name, defs[0]])
for (const [name, def] of renderTargets) {
  const Comp = typeof def.render === 'function' ? def.render : def.component || def.Component
  if (typeof Comp !== 'function') { ok(`renderable ${name}`, false, 'no component'); continue }
  try {
    for (let pass = 0; pass < 6 && (pass === 0 || dirty); pass++) { dirty = false; flatten(createElement(Comp, {}), []) }
    ok(`render ${name} without throw`, true)
  } catch (e) {
    ok(`render ${name} without throw`, false, e.message)
  }
}
for (const fn of effects) { try { await fn() } catch {} }
await new Promise((r) => setTimeout(r, 30))
// One more pass after effects ran (the panel loads data asynchronously).
for (const [name, def] of renderTargets) {
  const Comp = typeof def.render === 'function' ? def.render : def.component || def.Component
  if (typeof Comp !== 'function') continue
  try {
    flatten(createElement(Comp, {}), [])
    await new Promise((r) => setTimeout(r, 20))
    for (const fn of effects.splice(0)) { try { await fn() } catch {} }
    await new Promise((r) => setTimeout(r, 20))
    let text = ''
    for (let pass = 0; pass < 8; pass++) { dirty = false; text = flatten(createElement(Comp, {}), []).join(' ') }
    ok(`render ${name} clean`, true)
    if (name === 'settings.section') {
      ok('panel shows a trait label', text.includes('耐心'), text.slice(0, 120))
      ok('panel shows the hard rule', text.includes('绝不替我做主'))
      ok('star tag exists in the bundle', source.includes('★ 重要'))
      // Discovery: an archive of this very workspace must surface a way back
      // without opening settings.
      ok('archived workspace shows a banner', text.includes('被归档了'), text.slice(0, 200))
      ok('banner points at the profile panel, not settings', text.includes('打开人格档案'))
      ok('banner still offers merging the archive back', text.includes('合并回这里'))
    }
  } catch (e) {
    ok(`render ${name} clean`, false, e.message)
  }
}

// ---- a destructive button must arm before it fires ------------------------
{
  const sureSrc = source.slice(source.indexOf('function Sure('), source.indexOf('// One glyph'))
  ok('Sure guard exists', sureSrc.length > 0 && sureSrc.includes('4000'))
  const SureComp = new Function('h', 'useState', 'useEffect', `${sureSrc}\nreturn Sure`)(createElement, useState, useEffect)
  let fired = 0
  const node = createElement(SureComp, { label: '永久删除', confirm: '真要永久删？', onYes: () => { fired += 1 } })
  let nodes = expand(node)
  ok('guard shows the plain label first', textOf(nodes) === '永久删除', textOf(nodes))
  const btn = findNode(nodes, (n) => n.props && typeof n.props.onClick === 'function')
  if (btn) {
    btn.props.onClick({ stopPropagation() {} })
    nodes = expand(node)
    ok('first click only arms', textOf(nodes).includes('真要永久删'), textOf(nodes))
    ok('first click does not fire', fired === 0)
    const armedBtn = findNode(nodes, (n) => n.props && typeof n.props.onClick === 'function')
    if (armedBtn) {
      armedBtn.props.onClick({ stopPropagation() {} })
      ok('second click fires exactly once', fired === 1, String(fired))
    }
  }
  // Nothing irreversible may hang off a single click anywhere in the bundle: the
  // profile panel is now the only place that can destroy something for good.
  ok('permanent delete goes through the guard', /label: '永久删除',[\s\S]{0,160}?op: 'purgeProfile'/.test(source))
  const oneClick = /onClick:\s*\([^)]*\)\s*=>\s*(?:send|commit)\(\{\s*op:\s*'(?:purgeProfile|purgeOrphan|delEntry|delOtherEntry)'/
  ok('no one-click irreversible delete', !oneClick.test(source))
}

// ---- the first meeting must ask about the diary, and the ceiling must not
// ---- pretend to save when there is no workspace to save it on --------------
{
  const panelDef = (slots['settings.section'] || [])[0]
  const Panel = panelDef && (typeof panelDef.render === 'function' ? panelDef.render : panelDef.component || panelDef.Component)
  const settle = async () => {
    for (let pass = 0; pass < 8; pass++) { dirty = false; flatten(createElement(Panel, {}), []) }
    for (const fn of effects.splice(0)) { try { await fn() } catch {} }
    await new Promise((r) => setTimeout(r, 30))
    let nodes = []
    for (let pass = 0; pass < 10; pass++) { dirty = false; nodes = expand(createElement(Panel, {})) }
    return nodes
  }
  if (typeof Panel === 'function') {
    fixture.firstRun = false
    let nodes = await settle()
    let text = textOf(nodes)
    ok('first run asks about the drawer set', text.includes('开哪几个'), text.slice(0, 160))
    ok('first run offers the diary', text.includes('日记'))

    fixture.firstRun = true
    fixture.dir = ''
    nodes = await settle()
    const open = findNode(nodes, (n) => n.type === 'button' && (n.children || []).includes('设置'))
    if (open) open.props.onClick({ stopPropagation() {} })
    nodes = await settle()
    const num = findNode(nodes, (n) => n.type === 'input' && n.props && n.props.type === 'number')
    ok('ceiling field locks without a workspace', !!num && num.props.disabled === true)
    text = textOf(nodes)
    ok('locked field explains why', text.includes('先打开一个会话再改'), text.slice(-160))
  } else {
    ok('first run asks about the diary', false, 'panel missing')
  }
}

// ---- the profiles panel: every workspace is a card, archived ones say so, and
// ---- nothing irreversible is one click away ---------------------------------
{
  const panelDef = (slots['settings.section'] || [])[0]
  const Panel = panelDef && (typeof panelDef.render === 'function' ? panelDef.render : panelDef.component || panelDef.Component)
  const settle = async () => {
    for (let pass = 0; pass < 8; pass++) { dirty = false; flatten(createElement(Panel, {}), []) }
    for (const fn of effects.splice(0)) { try { await fn() } catch {} }
    await new Promise((r) => setTimeout(r, 30))
    let nodes = []
    for (let pass = 0; pass < 10; pass++) { dirty = false; nodes = expand(createElement(Panel, {})) }
    return nodes
  }
  if (typeof Panel === 'function') {
    bags.delete(Panel.name || 'anon') // remount the panel so it reads the current fixture instead of a stale copy
    fixture.firstRun = true
    fixture.dir = 'C:\\Users\\me\\Desktop\\ds'
    fixture.store.pending = []
    let nodes = await settle()
    const finishIntro = findNode(nodes, (n) => n.type === 'button' && (n.children || []).includes('开始'))
    if (finishIntro) finishIntro.props.onClick({ stopPropagation() {} })
    nodes = await settle()
    const refresh = findNode(nodes, (n) => n.type === 'button' && (n.children || []).includes('刷新'))
    if (refresh) refresh.props.onClick({ stopPropagation() {} })
    nodes = await settle()
    const open = findNode(nodes, (n) => n.type === 'button' && (n.children || []).includes('人格档案'))
    ok('the header offers the profiles panel', !!open)
    if (open) open.props.onClick({ stopPropagation() {} })
    nodes = await settle()
    const text = textOf(nodes)
    ok('profiles panel lists both cards', text.includes('ds') && text.includes('旧人格'), text.slice(0, 200))
    // 名字和来源一样时不重复（live 的 ds 不该再写一遍「来自「ds」」），
    // 名字不一样时（旧人格 ← ds）才写。
    const srcCount = (text.match(/来自「ds」/g) || []).length
    ok('a card says where it came from, but only when the name differs', srcCount === 1, `count=${srcCount}`)
    ok('an archived card is labelled', text.includes('已归档'), text.slice(0, 200))
    ok('export is offered', text.includes('导出到桌面…'))
    ok('import is offered', text.includes('导入档案文件…'))
    const del = findNode(nodes, (n) => n.type === 'button' && (n.children || []).includes('永久删除'))
    ok('deleting a profile exists', !!del)
    if (del) {
      del.props.onClick({ stopPropagation() {} })
      nodes = await settle()
      ok('one click only arms the delete', textOf(nodes).includes('确认删除'), textOf(nodes).slice(-120))
    }
  } else {
    ok('profiles panel lists both cards', false, 'panel missing')
  }
}

const failed = results.filter((r) => !r[1])
console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)

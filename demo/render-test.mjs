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
  workspaces: [{ dir: 'C:\\Users\\me\\Desktop\\ds', title: 'ds', lastSeen: 1 }],
  orphans: [{ id: 'o9', from: 'ds', type: 'archive', n: 3, at: '昨天', dir: 'C:\\Users\\me\\Desktop\\ds', storeId: 's1' }],
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
      ok('banner offers 找回', text.includes('找回'))
    }
  } catch (e) {
    ok(`render ${name} clean`, false, e.message)
  }
}

const failed = results.filter((r) => !r[1])
console.log(`${results.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)

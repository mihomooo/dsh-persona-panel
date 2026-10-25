// Checks the write gate: no token -> 403, token from GET -> 200.
// Runs the real index.js against a fake Cordis context and a temp DSH_HOME.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'pp-gate-'))

const { apply } = await import('../index.js')

let handler = null
const fakeCtx = {
  get: () => undefined,
  tools: { register: () => {} },
  systemPrompt: { section: () => {} },
  effect: (fn) => fn(),
  inject: (names, fn) => {
    fn({ webServer: { register: (opts) => { handler = opts.handler } } })
  },
}

apply(fakeCtx, {})

function fakeReq(method, body, headers) {
  const buf = Buffer.from(body ? JSON.stringify(body) : '')
  return {
    method,
    url: '/persona-panel/api',
    headers: { host: '127.0.0.1:1234', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      if (buf.length) yield buf
    },
  }
}

function fakeRes() {
  const out = { status: 0, body: null }
  return {
    writeHead(status) {
      out.status = status
      return this
    },
    end(payload) {
      out.body = payload ? JSON.parse(payload) : null
    },
    out,
  }
}

async function call(method, body, headers) {
  const res = fakeRes()
  await handler(fakeReq(method, body, headers), res)
  return res.out
}

const dir = 'C:\\tmp\\gate-ws'
const first = await call('GET', null, {})
const token = first.body && first.body.token
console.log('GET token present:', typeof token === 'string' && token.length === 32)

const noToken = await call('POST', { op: 'addTrait', dir, label: '耐心', intensity: 3 }, { origin: 'http://127.0.0.1:1234', 'sec-fetch-site': 'same-origin' })
console.log('POST without token ->', noToken.status)

const wrongToken = await call('POST', { op: 'addTrait', dir, label: '耐心', intensity: 3 }, { 'x-persona-token': 'deadbeef' })
console.log('POST with junk token ->', wrongToken.status)

const noPage = await call('POST', { op: 'addTrait', dir, label: '耐心', intensity: 3 }, { 'x-persona-token': token })
console.log('POST with token but no Origin/Sec-Fetch ->', noPage.status)

const ok = await call('POST', { op: 'addTrait', dir, label: '耐心', intensity: 3 }, { 'x-persona-token': token, 'sec-fetch-site': 'same-origin' })
console.log('POST with token + page headers ->', ok.status, '| traits:', (ok.body.store.self || []).map((e) => e.label).join(','))

const plainText = await call('POST', { op: 'addTrait', dir, label: '温柔' }, { 'x-persona-token': token, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' })
console.log('POST with text/plain content-type ->', plainText.status)

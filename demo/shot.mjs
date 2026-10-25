// Capture screenshots of specific prototype states via Edge CDP.
// Usage: node shot.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'file:///C:/Users/YTYisJWYdaddy/Desktop/ds/persona-plugin/demo/index.html';
const OUT = 'C:/Users/YTYisJWYdaddy/Desktop/ds/persona-plugin/demo';
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), 'edgeshot-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--force-device-scale-factor=1', '--window-size=1200,800',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

async function findPage() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = list.find(t => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page');
}

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = expression => send('Runtime.evaluate', { expression, returnByValue: true });

await send('Page.enable');
await send('Runtime.enable');

const shots = [
  { name: 'shot-first.png', url: BASE, wait: 1200, actions: '' },
  { name: 'shot-editor.png', url: BASE + '?skip=1', wait: 500, actions: "q('#addSelf').click(); q('#fKind'); true" },
  { name: 'shot-settings.png', url: BASE + '?skip=1', wait: 500, actions: "q('#btnSettings').click(); true" },
  { name: 'shot-event.png', url: BASE + '?skip=1', wait: 500, actions: "q('[data-tab=event]').click(); q('#demoAsk').click(); true" },
  { name: 'shot-paste.png', url: BASE + '?skip=1', wait: 500, actions: "q('#pasteSelf').click(); q('#doParse').click(); true" },
  { name: 'shot-delws.png', url: BASE + '?skip=1', wait: 500, actions: "q('.wsdel').click(); true" }
];

for (const s of shots) {
  await send('Page.navigate', { url: s.url });
  await sleep(s.wait);
  if (s.actions) await evaluate("(() => { const q = x => document.querySelector(x); " + s.actions + "; })()");
  await sleep(350);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, s.name), Buffer.from(r.result.data, 'base64'));
  console.log('saved ' + s.name);
}

ws.close();
edge.kill();
process.exit(0);

// UI smoke test: drives the prototype through Edge CDP, collects exceptions + assertions.
// Usage: node uitest.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'file:///C:/Users/YTYisJWYdaddy/Desktop/ds/persona-plugin/demo/index.html?skip=1';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'edgeprof-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1200,800', PAGE
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Edge did not start');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });

let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push('CONSOLE: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  }
};
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Runtime.enable');
await sleep(900);

const script = `
(() => {
  const log = [];
  const ok = (name, cond, extra) => log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' | ' + extra : ''));
  const q = s => document.querySelector(s);
  const click = el => { if (!el) throw new Error('missing element'); el.click(); };
  const badge = () => (q('.wsitem.on .badge') || {}).textContent || '';

  ok('sidebar rows', document.querySelectorAll('.wsitem').length === 3, document.querySelectorAll('.wsitem').length);
  ok('ds selected', q('.wsitem.on .nm').textContent.includes('ds'));
  ok('ds shows shared-by', badge().indexOf(String.fromCharCode(0x2194)) === 0, badge());
  ok('three tabs', document.querySelectorAll('.tab').length === 3);
  ok('persona chips', document.querySelectorAll('.chip').length === 3, document.querySelectorAll('.chip').length);
  ok('drawer hint', q('#drawer').textContent.includes('点左边任意一条'));

  click(document.querySelectorAll('.wsitem')[2]);
  ok('life shows source', badge().includes('共用自'), badge());
  ok('life reuses same persona', document.querySelectorAll('.chip').length === 3);

  click(q('.chip'));
  ok('drawer shows intensity', !!q('#intensity'));
  click(q('[data-iv="2"]'));
  ok('intensity becomes 2', q('#intensity .note').textContent.trim().startsWith('2'), q('#intensity .note').textContent.trim());
  ok('history logged', q('#drawer').textContent.includes('改过'));
  ok('evidence expanded by default', !!q('details.ev') && q('details.ev').open === true);
  q('details.ev').open = false;
  ok('evidence can fold', q('details.ev').open === false);
  q('details.ev').open = true;

  click(q('#addSelf'));
  ok('editor has kind select', !!q('#fKind'));
  ok('lexicon chips offered', document.querySelectorAll('[data-lex]').length >= 10, document.querySelectorAll('[data-lex]').length);
  click(document.querySelectorAll('[data-lex]')[9]);
  ok('lex chip fills label', q('#fLabel').value.length > 0, q('#fLabel').value);
  q('#fKind').value = 'note'; q('#fKind').dispatchEvent(new Event('change'));
  ok('label hidden for note', q('#wrapLabel').style.display === 'none');
  q('#fNote').value = '被重复问时先复述一遍问题';
  click(q('#saveEdit'));
  ok('note added', document.querySelectorAll('#main .row').length >= 1, document.querySelectorAll('#main .row').length);
  ok('modal closed', !q('#modals').innerHTML);

  ok('paste entry exists', !!q('#pasteSelf'));
  click(q('#pasteSelf'));
  ok('paste modal', !!q('#pText') && q('#pText').value.length > 20);
  click(q('#doParse'));
  ok('parsed traits', document.querySelectorAll('[data-pt]').length === 2, document.querySelectorAll('[data-pt]').length);
  ok('parsed notes', document.querySelectorAll('[data-pn]').length === 4, document.querySelectorAll('[data-pn]').length);
  ok('apply button swapped', !!q('#applyPaste'));
  const beforeCount = document.querySelectorAll('.chip').length;
  document.querySelectorAll('[data-pn]')[3].checked = false;
  click(q('#applyPaste'));
  ok('paste applied', document.querySelectorAll('.chip').length === beforeCount + 2, beforeCount + ' -> ' + document.querySelectorAll('.chip').length);
  ok('fixed note tagged', q('#main').textContent.includes('原样'));
  ok('hard tag applied | 3', document.querySelectorAll('#main .tag.hard').length === 3, document.querySelectorAll('#main .tag.hard').length);
  const firstNote = [...q('#main').querySelectorAll('.row')].find(r => r.dataset.type === 'self' && r.textContent.includes('原样'));
  ok('hard notes sort first', !!firstNote && firstNote.textContent.includes('不要用 emoji'), firstNote && firstNote.textContent.trim().slice(0, 12));
  click(firstNote.querySelector('[data-act=edit]'));
  ok('note is editable', !!q('#fNote') && !!q('#fHard') && q('#fHard').checked);
  q('#fHard').checked = false; click(q('#saveEdit'));
  ok('hard can be unset', document.querySelectorAll('#main .tag.hard').length === 2, document.querySelectorAll('#main .tag.hard').length);
  ok('modal closed after paste', !q('#modals').innerHTML);

  click(q('[data-tab=event]'));
  click(q('#demoAsk'));
  ok('ask modal', !!q('[data-yes]'), (q('.mh') || {}).textContent);
  click(q('[data-yes]'));
  ok('pending shown', q('#main').textContent.includes('待你决定'));
  click(q('[data-keep]'));
  ok('promise recorded', q('#main').textContent.includes('已记'));

  ok('no manual status button', !document.querySelector('[data-act=status]'));

  click(q('#btnCopy'));
  document.querySelector('input[name=mode][value=share]').click();
  ok('share preview', q('#cPrev').textContent.includes('同一份'), q('#cPrev').textContent.replace(/\\s+/g, ' ').slice(0, 70));
  click(q('#doCopy'));
  ok('modal closed after copy', !q('#modals').innerHTML);

  click(q('#btnSettings'));
  click(document.querySelectorAll('[data-sw=rec]')[1]);
  ok('switch toggles', state.settings.user.rec === false, JSON.stringify(state.settings.user));
  click(q('[data-close]'));
  const picTab = [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('画像'));
  ok('readonly badge', !!picTab && picTab.textContent.includes('只读'), picTab ? picTab.textContent.trim() : 'no tab');

  click(q('#btnClear'));
  click(q('#step1'));
  ok('step2 exists', !!q('#step2'));
  click(q('#step2'));
  ok('cleared to empty', q('#main').textContent.includes('还没有'), q('#main').textContent.replace(/\\s+/g, ' ').slice(0, 36));

  click(q('#btnSettings'));
  ok('archive listed', document.querySelectorAll('[data-restore]').length === 1, document.querySelectorAll('[data-restore]').length);
  click(q('[data-restore]'));
  ok('restore works', document.querySelectorAll('.wsitem').length === 3 && !q('#modals').innerHTML);

  firstRun();
  ok('firstrun opens', !!q('#gStart'));
  ok('firstrun has three checkboxes', document.querySelectorAll('[data-g]').length === 3, document.querySelectorAll('[data-g]').length);
  document.querySelector('[data-g=event]').checked = false;
  click(q('#gStart'));
  ok('firstrun closes', !q('#modals').innerHTML);
  ok('unchecked feature disappears', ![...document.querySelectorAll('.tab')].some(t => t.textContent.includes('事件')));

  // —— 删工作区：先铺一份干净的假数据，不受前面用例影响 ——
  for (const k in wsMeta) delete wsMeta[k];
  for (const k in stores) delete stores[k];
  for (const k in links) delete links[k];
  state.settings = {self:{on:true,rec:true},user:{on:true,rec:true},event:{on:true,rec:true}};
  wsMeta.ds = {name:'ds'}; wsMeta.life = {name:'生活'};
  stores.ds = {self:[{id:'s1',kind:'trait',label:'耐心',intensity:4,note:'',ev:['x'],hist:[]}], user:[], event:[], pending:[]};
  stores.life = {self:[], user:[], event:[], pending:[]};
  links.ds = {}; links.life = {self:'ds'};
  state.orphans = []; state.ws = 'life'; state.tab = 'self'; render();

  const beforeSelf = dataOf('ds','self').length;
  ok('child reads shared persona', dataOf('life','self').length === beforeSelf && beforeSelf === 1, dataOf('life','self').length);
  delWs('life');
  ok('child deleted', !wsMeta.life && !stores.life);
  ok('mother untouched', dataOf('ds','self').length === beforeSelf && state.orphans.length === 0, state.orphans.length);

  // —— 删母体：还在共用的那方继承同一份 ——
  wsMeta.sys = {name:'sys'}; stores.sys = {self:[],user:[],event:[],pending:[]}; links.sys = {self:'ds'};
  const sharedArr = dataOf('sys','self');
  delWs('ds');
  ok('mother gone', !wsMeta.ds);
  ok('heir keeps the same array', dataOf('sys','self') === sharedArr && dataOf('sys','self').length === beforeSelf);
  ok('no orphan while someone still uses it', state.orphans.length === 0, state.orphans.length);

  // —— 没人共用 → 进无主记忆，不删 ——
  wsMeta.solo = {name:'独苗'};
  stores.solo = {self:[], user:[{id:'u9',kind:'note',text:'只爱喝冰的',ev:['x'],hist:[]}], event:[], pending:[]};
  links.solo = {};
  delWs('solo');
  ok('orphan kept the memory', state.orphans.length === 1 && state.orphans[0].n === 1, state.orphans.length);
  openSettings();
  ok('orphan listed in settings', document.querySelectorAll('[data-back]').length === 1);
  click(q('[data-back]'));
  ok('orphan can be taken back', !!wsMeta.o1 && dataOf('o1','user').length === 1);

  // —— 永久删除要两次 ——
  wsMeta.solo2 = {name:'独苗2'};
  stores.solo2 = {self:[{id:'t9',kind:'trait',label:'稳',intensity:3,note:'',ev:['x'],hist:[]}], user:[], event:[], pending:[]};
  links.solo2 = {};
  delWs('solo2');
  const nOrph = state.orphans.length;
  openSettings();
  const pb = q('[data-purge]');
  click(pb);
  ok('purge asks twice', state.orphans.length === nOrph && pb.textContent.includes('再点'), pb.textContent);
  click(q('[data-purge]'));
  ok('purge finally removes', state.orphans.length === nOrph - 1, state.orphans.length);

  return log.join('\\n');
})()`;

const res = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: false });
if (res.result && res.result.exceptionDetails) {
  const d = res.result.exceptionDetails;
  console.log('EXCEPTION: ' + (d.exception?.description || d.text));
} else {
  console.log(res.result && res.result.result ? res.result.result.value : JSON.stringify(res));
}
await sleep(300);
console.log(problems.length ? '\n--- console ---\n' + problems.join('\n') : '\nconsole clean');

ws.close();
edge.kill();
process.exit(0);

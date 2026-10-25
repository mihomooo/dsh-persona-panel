/**
 * dsh-persona-panel — browser half.
 *
 * A settings section: workspaces on the left, three pages in the middle
 * (persona / profile / events), and on the right how each entry came to be.
 * Data lives in the host half; this file only renders and asks.
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/persona-panel/api'
    const TYPES = ['self', 'user', 'event', 'diary']
    const TITLES = { self: '人设卡', user: '画像', event: '事件', diary: '日记' }

    // The host mints a token per boot; every write has to carry it back.
    let TOKEN = ''

    async function call(body, retry = true) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-persona-token': TOKEN },
        body: JSON.stringify(body),
      })
      if (res.status === 403 && retry) {
        // A stale page has no token yet: pick one up, then try once more.
        try {
          const fresh = await fetch(API)
          const data = await fresh.json()
          if (data && typeof data.token === 'string') TOKEN = data.token
        } catch {}
        if (TOKEN) return call(body, false)
      }
      if (!res.ok) {
        let detail = ''
        try {
          const payload = await res.json()
          detail = payload && payload.error ? ` — ${payload.error}` : ''
        } catch {}
        throw new Error(`persona panel: ${res.status}${detail}`)
      }
      return res.json()
    }

    async function read(dir) {
      const url = dir ? `${API}?dir=${encodeURIComponent(dir)}` : API
      const res = await fetch(url)
      if (!res.ok) throw new Error(`persona panel: ${res.status}`)
      const data = await res.json()
      if (data && typeof data.token === 'string') TOKEN = data.token
      return data
    }

    const CSS = `
.pp-wrap{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;container-type:inline-size;min-width:0}
.pp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pp-title{font-size:15px;font-weight:600}
.pp-sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.pp-body{display:flex;gap:12px;min-height:380px;align-items:stretch}
.pp-col{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px;min-width:0}
.pp-left{width:190px;flex:0 0 auto}
.pp-mid{flex:1 1 auto;display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px;min-width:0}
.pp-right{width:230px;flex:0 0 auto}
.pp-wslist{display:flex;flex-direction:column;gap:2px}
/* 窄容器（设置页那种固定列宽）里三栏竖着排，别硬挤 */
@container (max-width: 760px){
  .pp-body{flex-direction:column;min-height:0}
  .pp-left,.pp-right{width:auto;flex:0 0 auto}
  .pp-wslist{flex-direction:row;flex-wrap:wrap}
  .pp-list{max-height:none}
}
@container (max-width: 520px){
  .pp-two{grid-template-columns:1fr}
}
.pp-main{padding:16px 20px 24px;overflow:auto;height:100%;box-sizing:border-box}
.pp-menurow{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 10px;border-radius:6px;cursor:pointer;font-family:inherit}
.pp-menurow:hover{background:var(--dsw-alias-bg-layer-2)}
.pp-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;background:transparent;color:currentColor;border-radius:6px;cursor:pointer}
.pp-iconbtn:hover{background:var(--dsw-alias-bg-layer-2)}
/* 会话里冒出来的那张小卡，不进面板 */
.pp-nudge{position:fixed;right:20px;bottom:96px;z-index:50;width:min(340px,86vw);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:12px;display:flex;flex-direction:column;gap:8px}
.pp-nudge h5{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.pp-nudge p{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-height:120px;overflow:auto;white-space:pre-wrap}
.pp-ws{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;cursor:pointer;line-height:1.3}
.pp-ws:hover{background:var(--dsw-alias-bg-layer-2)}
.pp-ws[data-on="1"]{background:var(--dsw-alias-bg-layer-2);font-weight:600}
.pp-wsname{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-badge{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px}
.pp-del{opacity:0;border:0;background:transparent;color:var(--dsw-alias-state-error-primary);cursor:pointer;font-size:13px}
.pp-ws:hover .pp-del{opacity:1}
.pp-tabs{display:flex;gap:6px;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:8px}
.pp-tab{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 10px;border-radius:999px;cursor:pointer;font-size:12.5px}
.pp-tab[data-on="1"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.pp-list{display:flex;flex-direction:column;gap:8px;overflow:auto;max-height:340px;padding-right:2px}
.pp-item{display:flex;gap:8px;align-items:flex-start;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:pointer}
.pp-item[data-on="1"]{border-color:var(--dsw-alias-brand-primary)}
.pp-grow{flex:1 1 auto;min-width:0}
.pp-txt{line-height:1.45;word-break:break-word}
.pp-mini{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.pp-meter{display:inline-flex;gap:2px;vertical-align:middle;margin-left:6px}
.pp-dot{width:7px;height:7px;border-radius:2px;background:var(--dsw-alias-state-idle-primary)}
.pp-dot[data-f="1"]{background:var(--dsw-alias-brand-primary)}
.pp-tag{font-size:10.5px;border-radius:4px;padding:0 4px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.pp-tag[data-hard="1"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.pp-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 10px;cursor:pointer;font-size:12px}
.pp-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.pp-btn[data-primary="1"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.pp-btn[data-danger="1"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.pp-btn[data-armed="1"]{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#fff;font-weight:600}
.pp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pp-empty{color:var(--dsw-alias-label-secondary);font-size:12px;padding:10px 2px;line-height:1.6}
.pp-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:auto;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.pp-drawer h4{margin:0 0 6px;font-size:12.5px}
.pp-drawer ol{margin:6px 0 0;padding-left:16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.pp-mask{position:fixed;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;z-index:60}
.pp-modal{width:min(560px,92vw);max-height:82vh;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}
.pp-modal h3{margin:0;font-size:15px}
.pp-field{display:flex;flex-direction:column;gap:4px}
.pp-field>label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.pp-field input[type=text],.pp-field input[type=number],.pp-field textarea,.pp-field select{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:6px 8px;color:var(--dsw-alias-label-primary);font-size:12.5px;font-family:inherit}
.pp-field textarea{min-height:64px;resize:vertical}
.pp-opt{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer}
.pp-opt input{margin-top:2px}
.pp-lex{display:flex;flex-wrap:wrap;gap:6px}
.pp-lex button{font-size:11.5px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;cursor:pointer}
.pp-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pp-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
`

    function Meter({ value }) {
      return h(
        'span',
        { className: 'pp-meter' },
        [0, 1, 2, 3, 4].map((i) => h('i', { key: i, className: 'pp-dot', 'data-f': i < value ? '1' : '0' })),
      )
    }

    // The branch drawings of the people who are not the user: QQ group members,
    // a shared chat, whoever the session hears from. Folded away unless the
    // workspace turned the feature on.
    function Others({ data, send, onSettings }) {
      const [q, setQ] = useState('')
      const [open, setOpen] = useState('')
      const [adding, setAdding] = useState('')
      const feature = (data.settings.features || {}).others || {}
      const list = (data.store && data.store.others) || []
      const shown = q.trim()
        ? list.filter((o) => `${o.name} ${(o.aliases || []).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
        : list
      if (feature.on !== true) {
        return h(
          'div',
          { className: 'pp-hint', style: { marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' } },
          list.length
            ? `他人画像：现在关着（${list.length} 人有记录）。打开后我会把他们纳入记忆，群聊里谁的事都分得清。`
            : '他人画像：现在关着。群聊里遇到别人时，打开它，我才会分出另一条支线。',
          ' ',
          h('button', { className: 'pp-btn', onClick: onSettings }, '去设置里打开'),
        )
      }
      const commit = async (body) => {
        await send(body)
      }
      return h(
        'div',
        { style: { marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' } },
        h(
          'div',
          { className: 'pp-row', style: { alignItems: 'center' } },
          h('div', { className: 'pp-sub', style: { margin: 0 } }, `同一屋檐下的其他人（${list.length}）`),
          h('span', { className: 'pp-grow' }),
          h('input', {
            type: 'text',
            value: q,
            placeholder: '按名字 / 别名搜',
            style: { width: 140 },
            onChange: (e) => setQ(e.target.value),
          }),
        ),
        h(
          'div',
          { className: 'pp-row', style: { marginTop: 6 } },
          h('input', {
            type: 'text',
            value: adding,
            placeholder: '加一个人：群里怎么叫他就怎么写',
            style: { flex: 1 },
            onChange: (e) => setAdding(e.target.value),
          }),
          h(
            'button',
            {
              className: 'pp-btn',
              disabled: !adding.trim(),
              onClick: async () => {
                const name = adding.trim()
                setAdding('')
                await commit({ op: 'addOther', name })
              },
            },
            '加上',
          ),
        ),
        shown.length
          ? shown.map((o) => {
              const isOpen = open === o.id
              const n = (o.user || []).length + (o.event || []).length
              return h(
                'div',
                { key: o.id, style: { marginTop: 8, borderTop: '1px dashed var(--dsw-alias-border-l1)', paddingTop: 6 } },
                h(
                  'div',
                  {
                    className: 'pp-row',
                    style: { cursor: 'pointer', alignItems: 'center' },
                    onClick: () => setOpen(isOpen ? '' : o.id),
                  },
                  h('span', { className: 'pp-grow' }, `${isOpen ? '▾' : '▸'} ${o.name}`),
                  h('span', { className: 'pp-mini' }, `${n} 条`),
                  h(
                    'button',
                    {
                      className: 'pp-btn',
                      'data-danger': '1',
                      style: { padding: '2px 7px' },
                      onClick: (e) => {
                        e.stopPropagation()
                        if (window.confirm(`删掉「${o.name}」和他的 ${n} 条记录？`)) commit({ op: 'delOther', id: o.id })
                      },
                    },
                    '删',
                  ),
                ),
                o.aliases && o.aliases.length
                  ? h('div', { className: 'pp-mini' }, `也叫：${o.aliases.join('、')}`)
                  : null,
                isOpen
                  ? h(
                      'div',
                      { style: { marginTop: 4 } },
                      (o.user || []).length
                        ? h('div', { className: 'pp-sub' }, '印象')
                        : null,
                      (o.user || []).map((u) =>
                        h(
                          'div',
                          { key: u.id, className: 'pp-row', style: { marginTop: 2 } },
                          h('span', { className: 'pp-grow' }, u.text),
                          h(Sure, {
                            label: '删',
                            confirm: '确认删除',
                            style: { padding: '1px 6px' },
                            onYes: () => commit({ op: 'delOtherEntry', otherId: o.id, bucket: 'user', id: u.id }),
                          }),
                        ),
                      ),
                      (o.event || []).length
                        ? h('div', { className: 'pp-sub' }, '他那边的事')
                        : null,
                      (o.event || []).map((ev) =>
                        h(
                          'div',
                          { key: ev.id, className: 'pp-row', style: { marginTop: 2 } },
                          h('span', { className: 'pp-grow' }, `${ev.date ? `${ev.date} ` : ''}${ev.text}`),
                          h(Sure, {
                            label: '删',
                            confirm: '确认删除',
                            style: { padding: '1px 6px' },
                            onYes: () => commit({ op: 'delOtherEntry', otherId: o.id, bucket: 'event', id: ev.id }),
                          }),
                        ),
                      ),
                      !n ? h('div', { className: 'pp-hint' }, '还没有记录。') : null,
                    )
                  : null,
              )
            })
          : h('div', { className: 'pp-hint', style: { marginTop: 6 } }, list.length ? '没有匹配的人。' : '还没有别人。加到人之后，群聊里就会分开记。'),
      )
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [dir, setDir] = useState('')
      const [tab, setTab] = useState('self')
      const [sel, setSel] = useState('')
      const [modal, setModal] = useState(null)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const [ask, setAsk] = useState(null)
      const [cand, setCand] = useState([])

      const apply = useCallback((next) => {
        if (!next || next.error) return
        setData(next)
        // The snapshot always names the workspace it answered for; follow it, or
        // a stale `dir` sends the next write into whichever workspace loaded first.
        if (next.dir) setDir(next.dir)
      }, [])

      const load = useCallback(async (target) => {
        try {
          const next = await read(target)
          setData(next)
          setDir(next.dir || target || '')
          if (!next.firstRun) setModal({ kind: 'firstRun' })
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [])

      useEffect(() => {
        load(dir)
      }, [])

      // An empty persona in a workspace that has a card file lying around: say so
      // once, quietly. No popup, no auto-import — the user still decides.
      const selfCount = data?.store?.self?.length || 0
      useEffect(() => {
        let alive = true
        if (!dir || selfCount > 0) {
          setCand([])
          return undefined
        }
        call({ op: 'importScan', dir })
          .then((r) => {
            if (alive) setCand((r && r.extra && r.extra.files) || [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [dir, selfCount])

      const store = data?.store || { self: [], user: [], event: [], diary: [], pending: [] }
      const list = store[tab] || []
      const selItem = list.find((x) => x.id === sel) || null

      const send = async (body) => {
        setBusy(true)
        try {
          const next = await call({ ...body, dir })
          apply(next)
          setErr('')
          return next
        } catch (e) {
          setErr(String(e.message || e))
          return null
        } finally {
          setBusy(false)
        }
      }

      // A queued question shows up as a card, never inside the chat.
      useEffect(() => {
        const pending = store.pending || []
        if (pending.length && !modal) setAsk(pending[0])
      }, [data, modal])

      if (!data) {
        return h('div', { className: 'pp-wrap' }, h('div', { className: 'pp-sub' }, err || '载入中…'))
      }

      const features = data.settings.features
      const tabOn = (k) => features[k]?.on !== false
      const tabs = TYPES.filter(tabOn)
      const cur = tabs.includes(tab) ? tab : tabs[0] || 'self'

      const openEdit = (item) => {
        setModal({ kind: 'edit', item: item || null, type: cur })
      }

      return h(
        'div',
        { className: 'pp-wrap' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'pp-head' },
          h(
            'div',
            null,
            h('div', { className: 'pp-title' }, '记忆'),
            h('div', { className: 'pp-sub' }, tabs.length ? '每一条都记着它是怎么来的。改坏了可以悔一步。' : '这个工作区三类都关着，所以这里没有内容。'),
          ),
          h(
            'div',
            { className: 'pp-row' },
            err ? h('span', { className: 'pp-sub' }, err) : null,
            h(
              'button',
              { className: 'pp-btn', title: '重新读一遍工作区列表（新工作区不用重启）', onClick: () => load(dir) },
              '刷新',
            ),
            h('button', { className: 'pp-btn', onClick: () => setModal({ kind: 'settings' }) }, '设置'),
          ),
        ),
        data.integrityWarn
          ? h(
              'div',
              {
                className: 'pp-hint',
                style: {
                  border: '1px solid var(--dsw-alias-state-warn-primary, var(--dsw-alias-border-l2))',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                },
              },
              h(
                'span',
                { className: 'pp-grow' },
                `插件文件在上次运行后被改过（${(data.integrityWarn.files || []).join('、')}）。如果不是你自己改的，先备份 ~/.dsh/persona-panel 再继续。`,
              ),
              h('button', { className: 'pp-btn', onClick: () => send({ op: 'acceptIntegrity' }) }, '是我改的'),
            )
          : null,
        h(
          'div',
          { className: 'pp-body' },
          // workspaces
          h(
            'div',
            { className: 'pp-col pp-left' },
            h('div', { className: 'pp-sub', style: { marginBottom: 6 } }, '工作区'),
            (data.workspaces || []).map((w) =>
              h(
                'div',
                {
                  key: w.dir,
                  className: 'pp-ws',
                  'data-on': w.dir === data.dir ? '1' : '0',
                  onClick: () => {
                    setSel('')
                    load(w.dir)
                  },
                },
                h('span', { className: 'pp-wsname', title: w.dir }, w.title || w.dir),
                w.sharedWith > 1 ? h('span', { className: 'pp-badge' }, `共用 ${w.sharedWith - 1}`) : null,
                h(
                  'button',
                  {
                    className: 'pp-del',
                    title: '删除工作区（只撤指针，记忆不跟着走）',
                    onClick: (e) => {
                      e.stopPropagation()
                      setModal({ kind: 'delws', w })
                    },
                  },
                  '×',
                ),
              ),
            ),
            !(data.workspaces || []).length ? h('div', { className: 'pp-empty' }, '还没有工作区。随便在一个工作区里说句话，它就会出现。') : null,
          ),
          // pages
          h(
            'div',
            { className: 'pp-mid' },
            (data.orphans || [])
              .filter((o) => o.dir === data.dir || (o.storeId && o.storeId === data.storeId))
              .map((o) =>
                h(
                  'div',
                  { key: o.id, className: 'pp-hint', style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: '8px 10px' } },
                  h(
                    'span',
                    { className: 'pp-grow' },
                    `这个工作区的 ${o.n} 条记忆在 ${o.at} 被${o.type === 'archive' ? '归档' : '摘出'}了。它们还在，只是不参与填写。`,
                  ),
                  h(
                    'button',
                    {
                      className: 'pp-btn',
                      'data-primary': '1',
                      onClick: async () => {
                        await send({ op: 'restoreArchive', id: o.id })
                      },
                    },
                    '找回',
                  ),
                  h('button', { className: 'pp-btn', onClick: () => setModal({ kind: 'settings' }) }, '去设置'),
                ),
              ),
            h(
              'div',
              { className: 'pp-tabs' },
              tabs.map((t) =>
                h(
                  'button',
                  { key: t, className: 'pp-tab', 'data-on': t === cur ? '1' : '0', onClick: () => { setTab(t); setSel('') } },
                  TITLES[t],
                  t === 'event' && (store.pending || []).length ? ` (${store.pending.length})` : '',
                  features[t]?.rec === false ? ' · 只读' : '',
                ),
              ),
              h('span', { className: 'pp-grow' }),
              !tabs.length
                ? h('button', { className: 'pp-btn', 'data-primary': '1', onClick: () => setModal({ kind: 'settings' }) }, '去设置里打开')
                : null,
              cur === 'self' && tabOn('self')
                ? h(
                    'span',
                    { className: 'pp-row' },
                    h('button', { className: 'pp-btn', onClick: () => openEdit(null) }, '＋ 加大类 / 加补充'),
                    h('button', { className: 'pp-btn', onClick: () => setModal({ kind: 'paste' }) }, '导入人设…'),
                  )
                : null,
            ),
            cur === 'self' && tabOn('self') && !selfCount && cand.length
              ? h(
                  'div',
                  { className: 'pp-hint', style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 } },
                  h('span', { className: 'pp-grow' }, `这个工作区还没有人设，但附近有 ${cand.length} 份像人设卡的文件（${cand.slice(0, 2).map((c) => c.name).join('、')}${cand.length > 2 ? '…' : ''}）`),
                  h('button', { className: 'pp-btn', onClick: () => setModal({ kind: 'paste' }) }, '导入'),
                )
              : null,
            h(
              'div',
              { className: 'pp-list' },
              list.length
                ? list.map((item) =>
                    h(
                      'div',
                      {
                        key: item.id,
                        className: 'pp-item',
                        'data-on': item.id === sel ? '1' : '0',
                        onClick: () => setSel(item.id),
                      },
                      h(
                        'div',
                        { className: 'pp-grow' },
                        h(
                          'div',
                          { className: 'pp-txt' },
                          item.kind === 'trait' ? item.label : item.text,
                          item.important ? h('span', { className: 'pp-tag', style: { marginLeft: 6, opacity: 0.9 }, title: '标为重要：注入时排最前，不受条数上限限制' }, '★ 重要') : null,
                          item.kind === 'work' ? h('span', { className: 'pp-tag', style: { marginLeft: 6, opacity: 0.9 }, title: '工程事件：项目推进、定下的方案、做完的一段工作' }, '工程') : null,
                          item.kind === 'trait' ? h(Meter, { value: item.intensity }) : null,
                          item.hard ? h('span', { className: 'pp-tag', 'data-hard': '1', style: { marginLeft: 6 } }, '硬') : null,
                          item.src === 'guess'
                            ? h(
                                'span',
                                {
                                  className: 'pp-tag',
                                  title: '这条写入时拿不到当前会话的目录，按界面最后停的工作区记的——可能记错了地方。',
                                  style: { marginLeft: 6, opacity: 0.75 },
                                },
                                '?',
                              )
                            : null,
                        ),
                        h(
                          'div',
                          { className: 'pp-mini' },
                          cur === 'diary'
                            ? `自述${item.date ? ` · ${item.date}` : ''}`
                            : `${item.ev && item.ev.length ? `来源：${item.ev[0]}` : item.kind === 'trait' ? '来源：日常相处里长出来' : '来源：对话'}${item.date ? ` · ${item.date}` : ''}`,
                        ),
                      ),
                      cur === 'diary'
                        ? h('span', { className: 'pp-tag', title: '这是它自己写下的，只能往下添，改不了也删不了' }, '只读')
                        : item.kind === 'trait'
                          ? // Traits never disappear in one click: the staged path
                            // opens first, whichever surface asked.
                            h(
                              'button',
                              {
                                className: 'pp-btn',
                                'data-danger': '1',
                                style: { padding: '2px 7px' },
                                onClick: (e) => { e.stopPropagation(); setModal({ kind: 'drop', item }) },
                              },
                              '删',
                            )
                          : h(Sure, {
                              label: '删',
                              confirm: '确认删除',
                              onYes: () => send({ op: 'delEntry', id: item.id }).then(() => setSel('')),
                            }),
                    ),
                  )
                : h(
                    'div',
                    { className: 'pp-empty' },
                    cur === 'self'
                      ? '人设卡还是空的。它不靠你填问卷，靠相处慢慢长——同一件事出现两三次，我才会写一条。'
                      : cur === 'user'
                        ? '我对你还没有印象。多聊几次再总结，写下来的每一条你都能删。'
                        : cur === 'diary'
                          ? '还没有日记。它想留下什么就写一条，写完不能改。'
                          : '还没有事件。承诺、约定、值得留下的时刻，会落在这里。',
                  ),
            ),
            cur === 'user' ? h(Others, { data, send, onSettings: () => setModal({ kind: 'settings' }) }) : null,
            h(
              'div',
              { className: 'pp-foot' },
              h('button', { className: 'pp-btn', onClick: () => setModal({ kind: 'copy' }) }, '复制…'),
              h('button', { className: 'pp-btn', 'data-danger': '1', onClick: () => setModal({ kind: 'archive' }) }, '归档…'),
            ),
          ),
          // drawer
          h(
            'div',
            { className: 'pp-col pp-right pp-drawer' },
            selItem
              ? h(
                  'div',
                  null,
                  h('h4', null, '这条是怎么来的'),
                  h('div', { className: 'pp-mini' }, selItem.ev && selItem.ev.length ? `原话：${selItem.ev[0]}` : '原话：没有留下'),
                  h('div', { className: 'pp-mini' }, `挡位：${data.settings.level === 'manual' ? '全手动' : data.settings.level === 'half' ? '半自动' : data.settings.level === 'active' ? '主动' : '全自动'}`),
                  selItem.kind === 'trait' ? h('div', { className: 'pp-mini' }, `强度：${selItem.intensity}/5`) : null,
                  h(
                    'ol',
                    null,
                    (selItem.hist || []).map((x, i) => h('li', { key: i }, `${x.at || ''}${x.what ? ` ${x.what}` : ''}`)),
                  ),
                  cur === 'diary'
                    ? h('div', { className: 'pp-hint', style: { marginTop: 8 } }, '这是它自己写的，只能往下添，改不了也删不了。')
                    : selItem.kind !== 'user'
                    ? h(
                        'div',
                        { className: 'pp-row', style: { marginTop: 8 } },
                        h('button', { className: 'pp-btn', onClick: () => openEdit(selItem) }, '改'),
                        cur === 'event'
                          ? h(
                              'button',
                              {
                                className: 'pp-btn',
                                onClick: async () => {
                                  await send({ op: 'markEvent', id: selItem.id, important: !selItem.important })
                                },
                              },
                              selItem.important ? '取消标重要' : '标为重要 ★',
                            )
                          : null,
                      )
                    : h('div', { className: 'pp-hint', style: { marginTop: 8 } }, '画像是我对你的印象，只能删、不能改。'),
                  (selItem.hist || []).length
                    ? h('div', { className: 'pp-hint' }, '悔一步只在手动改过之后出现，改第二次就消失。')
                    : null,
                )
              : h('div', { className: 'pp-empty' }, '点左边任意一条，这里会显示它的来源、改动史，以及能不能悔一步。'),
            data.sharedBy && data.sharedBy.length
              ? h('div', { className: 'pp-hint', style: { marginTop: 10 } }, `这份数据被 ${data.sharedBy.length + 1} 个工作区共用：${data.sharedBy.map((x) => x.title).join('、')}`)
              : null,
            data.sharedBy && data.sharedBy.length
              ? h('button', { className: 'pp-btn', style: { marginTop: 6 }, onClick: () => send({ op: 'cutShare' }) }, '切断共生')
              : null,
          ),
        ),
        modal && modal.kind === 'firstRun' ? h(FirstRun, { data, onDone: async (settings) => { setModal(null); apply(await send({ op: 'firstRun', settings })) } }) : null,
        modal && modal.kind === 'edit' ? h(Editor, { data, modal, onClose: () => setModal(null), send }) : null,
        modal && modal.kind === 'settings' ? h(Settings, { data, onClose: () => setModal(null), send }) : null,
        modal && modal.kind === 'copy' ? h(CopyBox, { data, onClose: () => setModal(null), send }) : null,
        modal && modal.kind === 'archive'
          ? h(Confirm, {
              title: `归档「${data.title}」的记忆`,
              body: `这会收走这里的 ${(data.store.self || []).length + (data.store.user || []).length + (data.store.event || []).length} 条，收进归档，工作区还在。归档里的东西不会丢：设置 → 无主记忆 → 找回…，或者归档后在这里直接点「找回」。永久删除才是不可逆的。`,
              confirm: `确认归档`,
              onClose: () => setModal(null),
              onOk: async () => {
                await send({ op: 'archive' })
                setModal(null)
              },
            })
          : null,
        modal && modal.kind === 'delws'
          ? h(Confirm, {
              title: `删除工作区「${modal.w.title}」`,
              body: '删的只是工作区，记忆跟着数据走，不跟着工作区走。还有人共用的话它接着用；没人用了就进「无主记忆」，从列表里消失，但不会当场销毁。',
              confirm: '删除工作区',
              onClose: () => setModal(null),
              onOk: async () => {
                await call({ op: 'delWorkspace', dir: modal.w.dir })
                setModal(null)
                await load('')
              },
            })
          : null,
        modal && modal.kind === 'paste' ? h(PasteBox, { data, onClose: () => setModal(null), send }) : null,
        modal && modal.kind === 'drop' ? h(TraitDrop, { item: modal.item, onClose: () => setModal(null), send }) : null,
        ask ? h(AskCard, { item: ask, cap: data.settings.eventsCap, count: (store.event || []).length, onClose: () => setAsk(null), send }) : null,
      )
    }

    function FirstRun({ data, onDone }) {
      const [userCall, setUserCall] = useState(data.settings.userCall || '')
      const [agentName, setAgentName] = useState(data.settings.agentName || 'DeepSeek Harness')
      const [level, setLevel] = useState(data.settings.level || 'half')
      const [picked, setPicked] = useState(['self', 'user', 'event'])
      const lv = [
        ['manual', '全手动', '只有我说「记」才写'],
        ['half', '半自动', '画像自动 · 承诺问我'],
        ['active', '主动', '情绪也问我'],
        ['auto', '全自动', '连承诺也直接记'],
      ]
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal' },
          h('h3', null, '我叫什么'),
          h(
            'div',
            { className: 'pp-field' },
            h('label', null, '我该怎么称呼你'),
            h('input', { type: 'text', value: userCall, onChange: (e) => setUserCall(e.target.value), placeholder: '你想我怎么叫你' }),
          ),
          h(
            'div',
            { className: 'pp-field' },
            h('label', null, '我给自己起的名字'),
            h('input', { type: 'text', value: agentName, onChange: (e) => setAgentName(e.target.value) }),
          ),
          h('div', { className: 'pp-hint' }, '不问你要人设，也不填性格问卷——我自己长。'),
          h('div', { className: 'pp-sub' }, '记忆做到多细（之后可改）'),
          h(
            'div',
            { className: 'pp-two' },
            lv.map(([v, n, d]) =>
              h(
                'label',
                { key: v, className: 'pp-opt' },
                h('input', { type: 'radio', name: 'pp-level', checked: level === v, onChange: () => setLevel(v) }),
                h('span', null, h('div', null, n), h('div', { className: 'pp-hint' }, d)),
              ),
            ),
          ),
          h('div', { className: 'pp-sub' }, '开哪几个'),
          h(
            'div',
            { className: 'pp-row' },
            ['self', 'user', 'event'].map((k) =>
              h(
                'label',
                { key: k, className: 'pp-row', style: { gap: 4 } },
                h('input', {
                  type: 'checkbox',
                  checked: picked.includes(k),
                  onChange: (e) => setPicked(e.target.checked ? [...picked, k] : picked.filter((x) => x !== k)),
                }),
                h('span', null, TITLES[k]),
              ),
            ),
          ),
          h('div', { className: 'pp-hint' }, '关掉的那个，在这里就不存在：不显示、不注入、也不记。'),
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h(
              'button',
              {
                className: 'pp-btn',
                'data-primary': '1',
                onClick: () => {
                  if (!picked.length) return
                  onDone({ userCall, agentName, level, features: picked })
                },
              },
              '开始',
            ),
          ),
        ),
      )
    }

    function Editor({ data, modal, onClose, send }) {
      const item = modal.item
      const isTrait = item ? item.kind === 'trait' : modal.type === 'self' && !item
      const [kind, setKind] = useState(item ? (item.kind === 'trait' ? 'trait' : 'note') : 'trait')
      const [label, setLabel] = useState(item?.label || '')
      const [intensity, setIntensity] = useState(item?.intensity ?? 3)
      const [note, setNote] = useState(item?.note || '')
      const [text, setText] = useState(item?.text || '')
      const [hard, setHard] = useState(!!item?.hard)
      const lexicon = data.settings.lexicon || []

      const save = async () => {
        if (item) {
          await send({ op: 'updateEntry', id: item.id, label, intensity, note, text, hard })
        } else if (kind === 'trait') {
          await send({ op: 'addTrait', label, intensity, note })
        } else {
          await send({ op: 'addNote', text, hard })
        }
        onClose()
      }

      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal' },
          h('h3', null, item ? '改一条' : '新增'),
          !item && modal.type === 'self'
            ? h(
                'div',
                { className: 'pp-field' },
                h('label', null, '加什么'),
                h(
                  'select',
                  { value: kind, onChange: (e) => setKind(e.target.value) },
                  h('option', { value: 'trait' }, '大类（带强度）'),
                  h('option', { value: 'note' }, '人格补充 / 硬约束'),
                ),
              )
            : null,
          kind === 'trait'
            ? h(
                'div',
                { className: 'pp-field' },
                h('label', null, '大类名字'),
                h('input', { type: 'text', value: label, onChange: (e) => setLabel(e.target.value), placeholder: '耐心 / 温柔 / 傲娇…' }),
                h(
                  'div',
                  { className: 'pp-lex' },
                  lexicon.map((w) => h('button', { key: w, onClick: () => setLabel(w) }, w)),
                ),
                h('div', { className: 'pp-hint' }, '词库只是省事，不是限定；聊天里长出新的词，直接写在上面。'),
                h(
                  'div',
                  { className: 'pp-field' },
                  h('label', null, '强度（0–5）'),
                  h('input', { type: 'number', min: 0, max: 5, value: intensity, onChange: (e) => setIntensity(Number(e.target.value)) }),
                ),
                h(
                  'div',
                  { className: 'pp-field' },
                  h('label', null, '补充说明（可选）'),
                  h('textarea', { value: note, onChange: (e) => setNote(e.target.value), placeholder: '行事作风，比如「被重复问时先复述一遍问题」' }),
                ),
              )
            : h(
                'div',
                { className: 'pp-field' },
                h('label', null, '写一条'),
                h('textarea', { value: text, onChange: (e) => setText(e.target.value) }),
                h(
                  'label',
                  { className: 'pp-row', style: { gap: 6 } },
                  h('input', { type: 'checkbox', checked: hard, onChange: (e) => setHard(e.target.checked) }),
                  h('span', { className: 'pp-hint' }, '标为硬约束（注入时排在人格补充最前面，不参与归纳）'),
                ),
              ),
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h('button', { className: 'pp-btn', onClick: onClose }, '取消'),
            h('button', { className: 'pp-btn', 'data-primary': '1', onClick: save }, '保存'),
          ),
        ),
      )
    }

    function Settings({ data, onClose, send }) {
      const s = data.settings
      const [level, setLevel] = useState(s.level)
      const [lex, setLex] = useState((s.lexicon || []).join(' '))
      const [cap, setCap] = useState(Number.isFinite(s.eventsCap) ? s.eventsCap : 20)
      const [agentName, setAgentName] = useState(s.agentName || '')
      const [userCall, setUserCall] = useState(s.userCall || '')
      const [feat, setFeat] = useState(JSON.parse(JSON.stringify(s.features)))
      const [restoreId, setRestoreId] = useState(null)
      const lv = [
        ['manual', '全手动', '只有我说「记」才写'],
        ['half', '半自动', '画像自动 · 承诺问我'],
        ['active', '主动', '情绪也问我'],
        ['auto', '全自动', '连承诺也直接记'],
      ]
      const commit = async (key, patch) => {
        setFeat({ ...feat, [key]: { ...feat[key], ...patch } })
        await send({ op: 'settings', settings: { feature: { key, ...patch } } })
      }
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal' },
          h('h3', null, '设置 · 记忆'),
          h('div', { className: 'pp-hint', style: { marginTop: -4, marginBottom: 8 } }, `只对「${data.title || '当前工作区'}」生效；别的工作区各有一份。`),
          h(
            'div',
            { className: 'pp-field' },
            h('label', null, '我该怎么称呼你'),
            h('input', { type: 'text', value: userCall, onChange: (e) => setUserCall(e.target.value) }),
          ),
          h(
            'div',
            { className: 'pp-field' },
            h('label', null, '我给自己起的名字'),
            h('input', { type: 'text', value: agentName, onChange: (e) => setAgentName(e.target.value) }),
          ),
          h('div', { className: 'pp-sub' }, '记忆做到多细'),
          h(
            'div',
            { className: 'pp-two' },
            lv.map(([v, n, d]) =>
              h(
                'label',
                { key: v, className: 'pp-opt' },
                h('input', { type: 'radio', name: 'pp-lvl2', checked: level === v, onChange: () => setLevel(v) }),
                h('span', null, h('div', null, n), h('div', { className: 'pp-hint' }, d)),
              ),
            ),
          ),
          h('div', { className: 'pp-sub' }, '记忆范围'),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 14px', alignItems: 'center' } },
            h('div', { className: 'pp-hint' }, '功能'),
            h('div', { className: 'pp-hint' }, '启用'),
            h('div', { className: 'pp-hint' }, '记录'),
            ...TYPES.flatMap((k) => [
              h('div', { key: `${k}-n` }, TITLES[k]),
              h('input', {
                key: `${k}-on`,
                type: 'checkbox',
                checked: feat[k]?.on !== false,
                onChange: (e) => commit(k, { on: e.target.checked }),
              }),
              h('input', {
                key: `${k}-rec`,
                type: 'checkbox',
                checked: feat[k]?.rec !== false,
                onChange: (e) => commit(k, { rec: e.target.checked }),
              }),
            ]),
            // Off by default: absent means off, so this reads checked only when
            // the workspace switched it on explicitly.
            h('div', { key: 'others-n' }, '他人画像'),
            h('input', {
              key: 'others-on',
              type: 'checkbox',
              checked: feat.others?.on === true,
              onChange: (e) => commit('others', { on: e.target.checked }),
            }),
            h('input', {
              key: 'others-rec',
              type: 'checkbox',
              checked: feat.others?.rec === true,
              onChange: (e) => commit('others', { rec: e.target.checked }),
            }),
          ),
          h('div', { className: 'pp-hint' }, '「启用」管看不看得见、注不注入；「记录」管还要不要新增。只关记录 = 只读。他人画像默认关：关着时他们的画像既不注入、也不新增。日记只能往下添，面板里改不了也删不了。'),
          h(
            'div',
            { className: 'pp-field' },
            h('label', null, '默认词库（空格或逗号分隔）'),
            h('textarea', { value: lex, onChange: (e) => setLex(e.target.value) }),
            h('div', { className: 'pp-hint' }, '词库只负责省事，它不限定我。'),
          ),
          h(
            'div',
            { className: 'pp-field' },
            h('label', null, '记着的事最多几条'),
            h('input', {
              type: 'number',
              min: 0,
              max: 999,
              value: cap,
              onChange: (e) => setCap(Number(e.target.value)),
            }),
            h('div', { className: 'pp-hint' }, '0 = 不限。满了的那条会挂成一张卡问你：腾位置，还是就到这里。标了 ★ 的条目不占这个数。'),
          ),
          (data.orphans || []).length
            ? h(
                'div',
                null,
                h('div', { className: 'pp-sub' }, `无主记忆（${data.orphans.length}）`),
                h('div', { className: 'pp-hint' }, '归档或删掉的工作区留下的记忆都在这里。「找回…」会并回当前工作区；「永久删除」不可逆。'),
                data.orphans.map((o) =>
                  h(
                    'div',
                    { key: o.id, className: 'pp-row', style: { marginTop: 4 } },
                    h('span', { className: 'pp-grow' }, `${o.from} · ${o.type === 'archive' ? '归档' : '工作区'} · ${o.n} 条 · ${o.at}`),
                    h('button', { className: 'pp-btn', onClick: () => setRestoreId(o.id) }, '找回…'),
                    h(Sure, {
                      label: '永久删除',
                      confirm: '真要永久删？',
                      onYes: () => send({ op: 'purgeOrphan', id: o.id }),
                    }),
                  ),
                ),
                restoreId
                  ? h(
                      'div',
                      { className: 'pp-hint', style: { marginTop: 6 } },
                      '并回当前工作区；已有的条目不重复。',
                      h(
                        'button',
                        {
                          className: 'pp-btn',
                          'data-primary': '1',
                          style: { marginLeft: 8 },
                          onClick: async () => {
                            await send({ op: 'restoreArchive', id: restoreId })
                            setRestoreId(null)
                          },
                        },
                        '确认找回',
                      ),
                    )
                  : null,
              )
            : null,
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h('button', {
              className: 'pp-btn',
              'data-primary': '1',
              onClick: async () => {
                await send({
                  op: 'settings',
                  settings: {
                    level,
                    agentName,
                    userCall,
                    eventsCap: Number.isFinite(Number(cap)) ? Math.max(0, Math.floor(Number(cap))) : 20,
                    lexicon: lex.split(/[\s,，、]+/).filter(Boolean),
                  },
                })
                onClose()
              },
            }, '保存'),
            h('button', { className: 'pp-btn', onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    function CopyBox({ data, onClose, send }) {
      const others = (data.workspaces || []).filter((w) => w.dir !== data.dir)
      const [from, setFrom] = useState(others[0]?.dir || '')
      const [mode, setMode] = useState('copy')
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal' },
          h('h3', null, '从别的工作区借记忆'),
          others.length
            ? h(
                'div',
                { className: 'pp-field' },
                h('label', null, '从哪来'),
                h('select', { value: from, onChange: (e) => setFrom(e.target.value) }, others.map((w) => h('option', { key: w.dir, value: w.dir }, w.title))),
                h('div', { className: 'pp-hint', style: { marginTop: 6 } }, '复制是两份，各走各的；共生是一份数据，改一处两处都变。'),
                h(
                  'div',
                  { className: 'pp-two' },
                  h(
                    'label',
                    { className: 'pp-opt' },
                    h('input', { type: 'radio', name: 'pp-mode', checked: mode === 'copy', onChange: () => setMode('copy') }),
                    h('span', null, h('div', null, '副本复制'), h('div', { className: 'pp-hint' }, '深拷贝一份，此后互不影响')),
                  ),
                  h(
                    'label',
                    { className: 'pp-opt' },
                    h('input', { type: 'radio', name: 'pp-mode', checked: mode === 'share', onChange: () => setMode('share') }),
                    h('span', null, h('div', null, '共生转移'), h('div', { className: 'pp-hint' }, '指向同一份，之后随时能切断')),
                  ),
                ),
              )
            : h('div', { className: 'pp-empty' }, '还没有别的工作区可以借。'),
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h('button', { className: 'pp-btn', onClick: onClose }, '取消'),
            h(
              'button',
              {
                className: 'pp-btn',
                'data-primary': '1',
                onClick: async () => {
                  if (from) await send({ op: 'copyFrom', from, mode })
                  onClose()
                },
              },
              mode === 'share' ? '共过来' : '复制过来',
            ),
          ),
        ),
      )
    }

    function PasteBox({ data, onClose, send }) {
      const [raw, setRaw] = useState('')
      const [parsed, setParsed] = useState(null)
      const [files, setFiles] = useState(null)
      const [sess, setSess] = useState(null)
      const [err, setErr] = useState('')
      const parse = () => {
        // Real parsing is the agent's job; the panel only shows what it got.
        const lines = raw
          .split(/[\n。；]+/)
          .map((x) => x.trim())
          .filter(Boolean)
        const traits = []
        const notes = []
        for (const line of lines.slice(0, 12)) {
          const m = line.match(/^(.{1,6}?)(?:[：:，,、]|$)/)
          const head = m ? m[1] : ''
          if (data.settings.lexicon?.includes(head)) traits.push({ label: head, intensity: 3, note: line })
          else notes.push({ text: line, hard: /不要|别|禁止|必须|一定/.test(line) })
        }
        setParsed({ traits, notes })
      }
      const scan = async () => {
        const r = await send({ op: 'importScan' })
        setFiles(r.extra?.files || [])
      }
      const pick = async (path) => {
        const r = await send({ op: 'importRead', path })
        if (r.extra?.error) {
          setErr(r.extra.error)
          return
        }
        setErr('')
        setParsed(null)
        setRaw(r.extra?.text || '')
        setFiles(null)
      }
      const readSessions = async () => {
        setErr('')
        const r = await send({ op: 'importSessions' })
        const x = (r && r.extra) || {}
        if (x.empty) {
          setErr('这个工作区还没有能读的会话记录。')
          return
        }
        setSess(x)
      }
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal' },
          h('h3', null, '导入人设'),
          h('div', { className: 'pp-hint' }, '可以贴一整段、从文件里读，或者把这个工作区的会话记录读出来让我分析。'),
          h(
            'div',
            { className: 'pp-row' },
            h('button', { className: 'pp-btn', onClick: scan }, files ? '重新找文件' : '从文件导入…'),
            h('button', { className: 'pp-btn', onClick: readSessions }, '读取会话记录…'),
            err ? h('span', { className: 'pp-mini', style: { color: 'var(--dsw-alias-state-error)' } }, err) : null,
          ),
          sess
            ? h(
                'div',
                { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 8, marginTop: 6 } },
                h('div', { className: 'pp-mini' }, `读了 ${sess.sessions} 个会话、${sess.turns} 轮对话、${sess.chars} 字`),
                h('div', { className: 'pp-mini', style: { wordBreak: 'break-all' } }, sess.path || '(没能落盘)'),
                h('div', { className: 'pp-hint', style: { marginTop: 4 } }, sess.queued ? (sess.kick && sess.kick.ok ? '已经叫醒这个工作区的会话：它这一轮就会读这份转写，拆完写进来。' : `已排好，但没能当场叫醒会话（${(sess.kick && sess.kick.why) || '未知原因'}）——你下次说话时我会先读它。`) : '没找到可读的会话。'),
                h('div', { style: { maxHeight: 120, overflow: 'auto', marginTop: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' } }, (sess.preview || '').slice(0, 900)),
              )
            : null,
          files
            ? h(
                'div',
                { style: { maxHeight: 180, overflow: 'auto', marginTop: 6 } },
                files.length === 0
                  ? h('div', { className: 'pp-hint' }, '本工作区和桌面上没找到像人设卡的文件。可以手动粘贴下面的文本。')
                  : files.map((f) =>
                      h(
                        'div',
                        { key: f.path, className: 'pp-row', style: { marginTop: 4, justifyContent: 'space-between' } },
                        h('div', null, h('div', null, f.name), h('div', { className: 'pp-mini' }, `${f.from} · ${Math.round(f.size / 1024)} KB · ${f.preview}`)),
                        h('button', { className: 'pp-btn', onClick: () => pick(f.path) }, '读这个'),
                      ),
                    ),
              )
            : null,
          h('textarea', { value: raw, onChange: (e) => setRaw(e.target.value), placeholder: '把角色卡、设定或一整段描述贴进来。', style: { minHeight: 96 } }),
          h(
            'div',
            { className: 'pp-hint', style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
            h('span', null, `已输入 ${raw.length} 字`),
            h('span', null, '「交给会话」= 我下一轮读它、按大类/补充/画像/事件拆好；本地粗拆只按词库猜，不准。'),
          ),
          parsed
            ? h(
                'div',
                null,
                parsed.traits.length || parsed.notes.length
                  ? h('div', { className: 'pp-mini' }, `粗拆结果：大类 ${parsed.traits.length} 条、补充 ${parsed.notes.length} 条（可能误判，别指望它）`)
                  : h('div', { className: 'pp-mini', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, '一条都没拆出来——本地规则只认词库里的词。改用「交给会话」。'),
                parsed.traits.map((t, i) => h('div', { key: `t${i}`, className: 'pp-mini' }, `大类：${t.label} · ${t.intensity}/5`)),
                parsed.notes.map((n, i) => h('div', { key: `n${i}`, className: 'pp-mini' }, `补充：${n.text}${n.hard ? '（硬）' : ''}`)),
              )
            : null,
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h('button', { className: 'pp-btn', onClick: onClose }, '取消'),
            h('button', { className: 'pp-btn', onClick: parse }, '本地粗拆'),
            parsed
              ? h(
                  'button',
                  {
                    className: 'pp-btn',
                    onClick: async () => {
                      const p = parsed
                      for (const t of p.traits) await send({ op: 'addTrait', label: t.label, intensity: t.intensity, note: t.note })
                      for (const n of p.notes) await send({ op: 'addNote', text: n.text, hard: n.hard })
                      onClose()
                    },
                  },
                  '照粗拆落盘',
                )
              : null,
            h(
              'button',
              {
                className: 'pp-btn',
                'data-primary': '1',
                disabled: !raw.trim(),
                onClick: async () => {
                  const r = await send({ op: 'stagePaste', text: raw })
                  const x = (r && r.extra) || {}
                  if (x.error) {
                    setErr(x.error)
                    return
                  }
                  if (x.kick && !x.kick.ok) {
                    setErr(`材料已放好，但没能当场叫醒会话（${x.kick.why}）——你下次说话时我会先读它。`)
                    return
                  }
                  onClose()
                },
              },
              '交给会话',
            ),
          ),
        ),
      )
    }

    // Traits are dropped in stages: notice the displeasure first, then lower the
    // intensity, and only then delete. The same order the agent tool enforces.
    function TraitDrop({ item, onClose, send }) {
      const [msg, setMsg] = useState('')
      const [armed, setArmed] = useState(false)
      const pushback = Number(item.pushback) || 0
      const intensity = Number(item.intensity) || 0
      const canRemove = pushback >= 2 || intensity === 0
      const step = async (intent, force) => {
        const r = await send({ op: 'traitStep', id: item.id, intent, force: !!force })
        const text = (r && r.extra && r.extra.text) || ''
        setMsg(text)
        if (/删掉了/.test(text)) setTimeout(onClose, 900)
      }
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal', style: { width: 'min(440px,92vw)' } },
          h('h3', null, `「${item.label}」怎么处理`),
          h('div', { className: 'pp-hint' }, `强度 ${intensity}/5 · 已记 ${pushback} 次疑似不满。跳步会被拒绝，这是故意的。`),
          msg ? h('div', { className: 'pp-mini' }, msg) : null,
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end', marginTop: 6 } },
            h('button', { className: 'pp-btn', onClick: () => step('notice') }, '记一次不满'),
            h('button', { className: 'pp-btn', onClick: () => step('reduce') }, '降一档'),
            h(
              'button',
              {
                className: 'pp-btn',
                'data-danger': '1',
                title: canRemove ? '' : '你自己动手，需要点两次',
                onClick: () => {
                  if (canRemove) return step('remove')
                  if (!armed) {
                    setArmed(true)
                    setMsg('你自己删的话，再点一次就真的没了。')
                    return
                  }
                  return step('remove', true)
                },
              },
              armed ? '再点一次确认' : '删除',
            ),
            h('button', { className: 'pp-btn', onClick: onClose }, '关掉'),
          ),
        ),
      )
    }

    function AskCard({ item, cap, count, onClose, send }) {
      // The event ceiling is a user decision, never the model's: the card offers
      // "make room" or "let this one go" and nothing is written until they pick.
      if (item.kind === 'capFull') {
        const limit = Number(item.capLimit || cap) || 20
        const shown = Number.isFinite(Number(item.capCount)) ? Number(item.capCount) : count
        const next = limit + 20
        return h(
          'div',
          { className: 'pp-mask' },
          h(
            'div',
            { className: 'pp-modal', style: { width: 'min(460px,92vw)' } },
            h('h3', null, '记着的事满了'),
            h('div', { className: 'pp-txt' }, item.text),
            h('div', { className: 'pp-hint' }, `${shown}/${limit} 条。这一条还没写进去——是给它腾个位置，还是就到这里？`),
            h(
              'div',
              { className: 'pp-row', style: { justifyContent: 'flex-end' } },
              h(
                'button',
                {
                  className: 'pp-btn',
                  onClick: async () => {
                    await send({ op: 'dropCapItem', id: item.id })
                    onClose()
                  },
                },
                '不记了',
              ),
              h(
                'button',
                {
                  className: 'pp-btn',
                  onClick: async () => {
                    await send({ op: 'raiseCap', value: next })
                    onClose()
                  },
                },
                `扩到 ${next} 条`,
              ),
              h(
                'button',
                {
                  className: 'pp-btn',
                  'data-primary': '1',
                  onClick: async () => {
                    await send({ op: 'raiseCap', value: 0 })
                    onClose()
                  },
                },
                '不限条数',
              ),
            ),
          ),
        )
      }
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal', style: { width: 'min(460px,92vw)' } },
          h('h3', null, item.title || '这个我想留着'),
          h('div', { className: 'pp-txt' }, item.text),
          h('div', { className: 'pp-hint' }, '这句话我收着？'),
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h(
              'button',
              {
                className: 'pp-btn',
                onClick: async () => {
                  await send({ op: 'askDecided', id: item.id, accept: false })
                  onClose()
                },
              },
              '先不用',
            ),
            h(
              'button',
              {
                className: 'pp-btn',
                'data-primary': '1',
                onClick: async () => {
                  await send({
                    op: 'askDecided',
                    id: item.id,
                    accept: true,
                    entry: { kind: item.kind || 'promise', text: item.text, date: item.date || '', status: 'open', ev: [item.text] },
                  })
                  onClose()
                },
              },
              '留着',
            ),
          ),
        ),
      )
    }

    function Confirm({ title, body, confirm, onClose, onOk }) {
      return h(
        'div',
        { className: 'pp-mask' },
        h(
          'div',
          { className: 'pp-modal', style: { width: 'min(440px,92vw)' } },
          h('h3', null, title),
          h('div', { className: 'pp-txt' }, body),
          h(
            'div',
            { className: 'pp-row', style: { justifyContent: 'flex-end' } },
            h('button', { className: 'pp-btn', onClick: onClose }, '算了'),
            h('button', { className: 'pp-btn', 'data-danger': '1', onClick: onOk }, confirm),
          ),
        ),
      )
    }

    // Two clicks, never one: the button that destroys something arms itself
    // first, and disarms after four seconds so a stray click cannot linger as
    // a live weapon.
    function Sure({ label, confirm: confirmLabel, onYes, style, danger }) {
      const [armed, setArmed] = useState(false)
      useEffect(() => {
        if (!armed) return undefined
        const t = setTimeout(() => setArmed(false), 4000)
        return () => clearTimeout(t)
      }, [armed])
      return h(
        'button',
        {
          className: 'pp-btn',
          'data-danger': danger === false ? undefined : '1',
          'data-armed': armed ? '1' : undefined,
          style: style || { padding: '2px 7px' },
          onClick: (e) => {
            e.stopPropagation()
            if (!armed) { setArmed(true); return }
            setArmed(false)
            onYes()
          },
        },
        armed ? confirmLabel || '再点一次确认' : label,
      )
    }

    // One glyph for the sidebar row: three stacked cards = 「记着的事」.
    function Glyph({ size }) {
      const s = size || 16
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.5, y: 1.5, width: 11, height: 13, rx: 2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M5.5 5.5h5M5.5 8.5h5M5.5 11.5h3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    const PANEL_ID = 'persona-panel'

    // A queued promise/question shows up in the conversation itself, not only in
    // the panel: the panel is where you review, the chat is where it happens.
    function PendingNudge() {
      const [item, setItem] = useState(null)
      const [dir, setDir] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const d = await read('')
            if (!alive) return
            setDir(d && d.dir ? d.dir : '')
            const list = (d && d.store && d.store.pending) || []
            setItem(list.length ? list[0] : null)
          } catch {}
        }
        tick()
        const timer = setInterval(tick, 20000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      if (!item) return null
      const decide = async (accept) => {
        setBusy(true)
        try {
          await call({
            op: 'askDecided',
            dir,
            id: item.id,
            accept,
            entry: accept ? { kind: item.kind || 'promise', text: item.text, date: item.date || '', status: 'open', ev: [item.text] } : undefined,
          })
          setItem(null)
        } catch {
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'pp-nudge' },
        h('style', null, CSS),
        h('h5', null, item.title || '这个我想留着'),
        h('p', null, item.text),
        h(
          'div',
          { className: 'pp-row', style: { justifyContent: 'flex-end' } },
          h('button', { className: 'pp-btn', disabled: busy, onClick: () => decide(false) }, '先不用'),
          h('button', { className: 'pp-btn', 'data-primary': '1', disabled: busy, onClick: () => decide(true) }, '留着'),
        ),
      )
    }

    function MainPanel() {
      return h('div', { className: 'pp-main' }, h(Panel))
    }

    // The Session "..." row: jump straight to this workspace's memory.
    function MenuRow(props) {
      const hook = props && props.useMenuOpenState
      let close = null
      if (typeof hook === 'function') {
        const state = hook()
        if (Array.isArray(state) && typeof state[1] === 'function') close = state[1]
      }
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'pp-menurow',
          onClick: () => {
            if (close) close(false)
            selectPanel()
          },
        },
        '记忆',
      )
    }

    let layoutRef = null
    function selectPanel() {
      if (!layoutRef || typeof layoutRef.selectPanel !== 'function') return
      try {
        layoutRef.selectPanel(PANEL_ID)
      } catch (e) {
        /* the panel key is not registered yet — nothing to select */
      }
    }

    // Registering into a slot that no owner has declared yet throws
    // ("slot X is not declared"), and that throw fails the whole Client entry —
    // which aborts the desktop boot. `slots.inject(name, cb)` is the documented
    // way to wait for the declaration, so every seat goes through it.
    function noteFailure(where, error) {
      try {
        // eslint-disable-next-line no-console
        console.error(`[persona-panel] ${where}: ${error && error.message ? error.message : error}`)
      } catch {}
      try {
        call({ op: 'clientError', where, message: String((error && error.stack) || error) })
      } catch {}
    }

    function seat(where, name, register) {
      try {
        ctxSlots.inject(name, () => {
          try {
            register()
          } catch (error) {
            noteFailure(where, error)
          }
        })
      } catch (error) {
        noteFailure(where, error)
      }
    }

    let ctxSlots = null

    return {
      inject: ['slots'],
      apply(ctx) {
        ctxSlots = ctx.slots
        try {
          const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') layoutRef = layout
        } catch (error) {
          noteFailure('layout', error)
        }

        // 1) A full-width centre panel: this is where the three columns breathe.
        seat('main', 'main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, label: () => '记忆' }, MainPanel),
        )

        // 2) Sidebar icon, so the panel is one click away.
        seat('panellist', 'sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => '记忆' },
            (owner) => h(Glyph, { size: (owner && owner.size) || 16 }),
          ),
        )

        // 3) The Session "..." menu row.
        seat('session-menu', 'sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'persona-panel-memory', order: 500 },
            MenuRow,
          ),
        )

        // 4) Settings keeps an entry too, but it is the same panel — narrow
        //    containers stack the columns instead of squeezing them.
        seat('settings', 'settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: PANEL_ID, order: 40, label: () => '记忆' }, Panel),
        )

        // 5) In-conversation card for a queued promise/question.
        seat('nudge', 'shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'persona-panel-nudge', order: 900 }, PendingNudge),
        )
      },
    }
  },
})

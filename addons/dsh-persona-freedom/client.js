/**
 * dsh-persona-freedom —— client 半端
 * ============================================================================
 * 设置里独立一页「自由时间」：自由度四个旋钮。
 *
 * 读 `/api/persona-freedom/status`（当前值 + 每行说明）
 * 存 `/api/persona-freedom/config`（白名单字段，写前留 .bak）
 *
 * 这一页只放「能调的行为」，不放路径：工作区写错一个字符，账就落到别人家目录去了。
 * 也**不放日程正文**——单子是自己的事，用 free_add / free_select 改，不该在设置页批量派活。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-freedom',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-freedom'

    const T = {
      page: {
        boxSizing: 'border-box', height: '100%', overflowY: 'auto',
        padding: '30px 40px 72px', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit',
      },
      inner: { maxWidth: 820, margin: '0 auto' },
      h1: { margin: 0, fontSize: 21, fontWeight: 650 },
      sub: { margin: '7px 0 22px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.75 },
      card: {
        borderRadius: 12, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l1)', overflow: 'hidden', marginBottom: 22,
      },
      row: {
        display: 'flex', gap: 18, alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '13px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      rowFirst: { borderTop: 'none' },
      grow: { minWidth: 0, flex: '1 1 auto' },
      label: { fontSize: 13.5, fontWeight: 550 },
      hint: { marginTop: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.65 },
      input: {
        boxSizing: 'border-box', width: 108, padding: '6px 9px', fontSize: 13,
        color: 'inherit', background: 'var(--dsw-alias-bg-l2)',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, outline: 'none',
      },
      select: {
        boxSizing: 'border-box', maxWidth: 320, padding: '6px 9px', fontSize: 13,
        color: 'inherit', background: 'var(--dsw-alias-bg-l2)',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, outline: 'none',
      },
      area: {
        boxSizing: 'border-box', width: '100%', minHeight: 78, padding: '9px 11px', fontSize: 13,
        color: 'inherit', background: 'var(--dsw-alias-bg-l2)', lineHeight: 1.7, resize: 'vertical',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, outline: 'none',
      },
      switch: (on) => ({
        flex: '0 0 auto', position: 'relative', width: 40, height: 22, padding: 0, border: 'none',
        borderRadius: 11, cursor: 'pointer', transition: 'background .15s',
        background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)',
      }),
      knob: (on) => ({
        position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: 8,
        background: '#fff', transition: 'left .15s', display: 'block',
      }),
      actions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 },
      primary: {
        padding: '7px 16px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none',
        color: '#fff', background: 'var(--dsw-alias-state-info-primary)',
      },
      ghost: {
        padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
        color: 'inherit', background: 'var(--dsw-alias-bg-l2)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      dirty: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
      bad: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      footer: {
        marginTop: 22, fontSize: 11.5, lineHeight: 1.75,
        color: 'var(--dsw-alias-label-secondary)',
      },
    }

    function FreedomSettings() {
      const [state, setState] = React.useState({ loading: true })
      const [draft, setDraft] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [saved, setSaved] = React.useState('')
      const [error, setError] = React.useState('')

      const load = React.useCallback(async () => {
        setBusy(true)
        try {
          const r = await fetch(`${API}/status`, { headers: { accept: 'application/json' } })
          const j = await r.json()
          if (!j.ok) throw new Error(j.why || '读不到')
          setState({ loading: false, settings: j.settings || {}, fields: j.fields || [] })
          setDraft({})
          setError('')
        } catch (e) {
          setState({ loading: false, settings: {}, fields: [] })
          setError(String(e?.message || e))
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const dirty = Object.keys(draft).length > 0
      const valueOf = (key) => (key in draft ? draft[key] : state.settings?.[key])
      const setOne = (key, v) => { setSaved(''); setDraft((d) => ({ ...d, [key]: v })) }

      const save = async () => {
        if (!dirty) { setSaved('没有改动'); return }
        setBusy(true)
        setError('')
        try {
          const r = await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          })
          const j = await r.json()
          if (!j.ok) throw new Error(j.why || '没写进去')
          setSaved('存好了')
          setDraft({})
          await load()
        } catch (e) {
          setError(String(e?.message || e))
        } finally {
          setBusy(false)
        }
      }

      if (state.loading) {
        return h('div', { style: T.page }, h('div', { style: T.inner },
          h('h1', { style: T.h1 }, '自由时间'),
          h('p', { style: T.sub }, '正在读……')))
      }

      const fields = state.fields || []

      return h('div', { style: T.page }, h('div', { style: T.inner },
        h('h1', { style: T.h1 }, '自由时间'),
        h('p', { style: T.sub },
          '这一页调的是「我自己能给自己多大权限」：记不记、提不提、能不能自己加事。',
          h('br'),
          '日程正文不在这儿改——单子用 free_add / free_done / free_select，自己划自己挪。'),

        h('div', { style: T.card },
          fields.map((row, i) => {
            const v = valueOf(row.key)
            let control
            if (row.options) {
              control = h('select', {
                style: T.select, disabled: busy,
                value: v == null ? '' : String(v),
                onChange: (e) => setOne(row.key, Number(e.target.value)),
              }, row.options.map((o) => h('option', { key: String(o.value), value: String(o.value) }, o.label)))
            } else if (row.type === 'boolean') {
              control = h('button', {
                type: 'button', role: 'switch', 'aria-checked': !!v, title: v ? '开' : '关',
                style: T.switch(!!v), disabled: busy, onClick: () => setOne(row.key, !v),
              }, h('span', { style: T.knob(!!v) }))
            } else if (row.type === 'number') {
              control = h('input', {
                type: 'number', min: row.min, max: row.max, style: T.input, disabled: busy,
                value: v == null ? '' : String(v),
                onChange: (e) => {
                  const raw = e.target.value
                  if (raw === '') { setOne(row.key, 0); return }
                  const n = Number(raw)
                  setOne(row.key, Number.isFinite(n) ? n : 0)
                },
              })
            } else if (row.type === 'list') {
              control = h('textarea', {
                style: T.area, disabled: busy,
                value: Array.isArray(v) ? v.join('\n') : String(v || ''),
                onChange: (e) => setOne(row.key, String(e.target.value).split(/\n/).map((s) => s.trim()).filter(Boolean)),
              })
            } else {
              control = h('input', {
                type: 'text', style: T.input, disabled: busy,
                value: v == null ? '' : String(v),
                onChange: (e) => setOne(row.key, e.target.value),
              })
            }
            return h('div', { key: row.key, style: i === 0 ? { ...T.row, ...T.rowFirst } : T.row },
              h('div', { style: T.grow },
                h('div', { style: T.label }, row.label),
                row.hint ? h('div', { style: T.hint }, row.hint) : null),
              h('div', { style: { flex: row.type === 'list' ? '0 0 46%' : '0 0 auto' } }, control))
          })),
        ),

        h('div', { style: T.actions },
          h('button', { style: T.primary, disabled: busy || !dirty, onClick: save }, busy ? '存……' : '保存'),
          h('button', { style: T.ghost, disabled: busy, onClick: load }, '重新读'),
          dirty ? h('span', { style: T.dirty }, '有改动还没存') : null,
          saved ? h('span', { style: T.ok }, saved) : null,
          error ? h('span', { style: T.bad }, `没成：${error}`) : null,
        ),

        h('div', { style: T.footer },
          h('div', {}, '这几项每步现读，存完下一步就生效；不用重启。'),
          h('div', {}, '自由度只管「我能给自己多大权限」，不管流程——流程是更新指南里那些判据。'),
        ),
      ))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona-freedom',
          order: 46,
          label: '自由时间',
        }, FreedomSettings))
      },
    }
  },
})

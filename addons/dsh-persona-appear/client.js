/**
 * dsh-persona-appear —— client 半端
 * ============================================================================
 * 设置里独立一页「人格出现 · 实时注入」。
 *
 * 读 `/api/persona-appear/status`（当前真在用的值 + 每行说明）
 * 存 `/api/persona-appear/config`（只收白名单字段，写前留 .bak）
 *
 * 原则：这一页不碰「谁出不出场」——那是工具（appear_mute / appear_global）干的活，
 * 一次改动全家都受影响，不该混在一堆输入框里点错。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-appear',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-appear'

    const T = {
      page: {
        boxSizing: 'border-box', height: '100%', overflowY: 'auto',
        padding: '30px 40px 72px', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit',
      },
      inner: { maxWidth: 820, margin: '0 auto' },
      h1: { margin: 0, fontSize: 21, fontWeight: 650 },
      sub: { margin: '7px 0 26px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.75 },
      section: { marginBottom: 24 },
      sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 9 },
      h2: { margin: 0, fontSize: 14, fontWeight: 600 },
      card: {
        borderRadius: 12, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l1)', overflow: 'hidden',
      },
      row: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      rowFirst: { borderTop: 'none' },
      label: { fontSize: 13 },
      hint: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6, marginTop: 2 },
      grow: { flex: 1, minWidth: 0 },
      input: {
        boxSizing: 'border-box', fontSize: 13, padding: '6px 9px', width: 110, textAlign: 'right',
        borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit',
      },
      unit: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      switch: (on) => ({
        width: 38, height: 21, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)',
        position: 'relative', flex: 'none', padding: 0,
      }),
      knob: (on) => ({
        position: 'absolute', top: 2, left: on ? 19 : 2, width: 17, height: 17,
        borderRadius: '50%', background: '#fff', transition: 'left .12s',
      }),
      bar: {
        position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 0', marginTop: 8, flexWrap: 'wrap',
        background: 'var(--dsw-alias-bg-base)', borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      primary: {
        fontSize: 13, padding: '8px 20px', borderRadius: 9, cursor: 'pointer', fontWeight: 600,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-base)',
      },
      ghost: {
        fontSize: 13, padding: '8px 16px', borderRadius: 9, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
      },
      dirty: { fontSize: 12, color: 'var(--dsw-alias-state-warning-primary)' },
      ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
      bad: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      footer: { marginTop: 18, fontSize: 11.5, lineHeight: 1.9, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' },
    }

    function AppearSettings() {
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
          if (!j.ok) throw new Error(j.error || '读不到')
          setState({ loading: false, ...j })
          setDraft({})
          setError('')
        } catch (e) {
          setState({ loading: false, fields: [], values: {} })
          setError(String(e?.message || e))
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const dirty = Object.keys(draft).length > 0
      const valueOf = (key) => (key in draft ? draft[key] : state.values?.[key])
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
          if (!j.ok) throw new Error(j.error || '没写进去')
          setSaved(`存好了：${(j.saved || []).join('、')}`)
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
          h('h1', { style: T.h1 }, '人格出现 · 实时注入'),
          h('p', { style: T.sub }, '正在读……')))
      }

      const groups = state.fields || []
      const sections = groups.map((g, gi) => h('div', { key: `g${gi}`, style: T.section },
        h('div', { style: T.sectionHead }, h('h2', { style: T.h2 }, g.group)),
        h('div', { style: T.card },
          (g.rows || []).map((row, ri) => {
            const v = valueOf(row.key)
            return h('div', { key: row.key, style: ri === 0 ? { ...T.row, ...T.rowFirst } : T.row },
              h('div', { style: T.grow },
                h('div', { style: T.label }, row.label),
                row.hint ? h('div', { style: T.hint }, row.hint) : null),
              row.toggle
                ? h('button', {
                  type: 'button', role: 'switch', 'aria-checked': !!v, title: v ? '开' : '关',
                  style: T.switch(!!v), disabled: busy, onClick: () => setOne(row.key, !v),
                }, h('span', { style: T.knob(!!v) }))
                : h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('input', {
                    type: 'number', min: 0, style: T.input,
                    value: v == null ? '' : String(v), disabled: busy,
                    onChange: (e) => {
                      const raw = e.target.value
                      if (raw === '') { setOne(row.key, null); return }
                      const n = Number(raw)
                      setOne(row.key, Number.isFinite(n) ? n : null)
                    },
                  }),
                  row.unit ? h('span', { style: T.unit }, row.unit) : null),
            )
          })),
      ))

      return h('div', { style: T.page }, h('div', { style: T.inner },
        h('h1', { style: T.h1 }, '人格出现 · 实时注入'),
        h('p', { style: T.sub },
          '这一页只管临时摆进来的那一段：要不要摆、摆多久、单条多长。',
          h('br'),
          '谁出场谁不出场不在这儿——那是工具 `appear_mute` / `appear_global` 管的事。'),

        state.fileExists === false
          ? h('div', {
            style: {
              padding: '11px 14px', marginBottom: 18, borderRadius: 10, fontSize: 12.5, lineHeight: 1.7,
              border: '1px solid var(--dsw-alias-border-l1)',
              color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-l1)',
            },
          }, '还没有设置文件——现在用的是默认值。改一项再存，就会落成一份。')
          : null,

        ...sections,

        h('div', { style: T.bar },
          h('button', { style: T.primary, disabled: busy || !dirty, onClick: save }, busy ? '存……' : '保存'),
          h('button', { style: T.ghost, disabled: busy, onClick: load }, '重新读'),
          dirty ? h('span', { style: T.dirty }, '有改动还没存') : null,
          saved ? h('span', { style: T.ok }, saved) : null,
          error ? h('span', { style: T.bad }, `没成：${error}`) : null,
        ),

        h('div', { style: T.footer },
          h('div', {}, `设置存在：${state.file || '（没找到可写位置）'}`),
          h('div', {}, '实时注入这几项是每轮现读的，存完下一轮就生效。'),
        ),
      ))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona-appear',
          order: 44,
          label: '人格出现',
        }, AppearSettings))
      },
    }
  },
})

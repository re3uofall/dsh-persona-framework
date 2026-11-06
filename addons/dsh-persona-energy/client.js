/**
 * dsh-persona-energy —— client 半端
 * ============================================================================
 * 设置里独立一页「人格电量」。
 *
 * 读 `/api/persona-energy/status`（当前真在用的值 + 每行说明 + 此刻的电量）
 * 存 `/api/persona-energy/config`（只收白名单字段，写前留 .bak）
 *
 * 这一页只放「可调的行为」，不放路径：工作区与 stateDir 写错一个字符，
 * 账就落到别的目录去了，症状是「插件在跑，电量与 token 账都是空的」。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-energy',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-energy'

    const T = {
      page: {
        boxSizing: 'border-box', height: '100%', overflowY: 'auto',
        padding: '30px 40px 72px', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit',
      },
      inner: { maxWidth: 820, margin: '0 auto' },
      h1: { margin: 0, fontSize: 21, fontWeight: 650 },
      sub: { margin: '7px 0 22px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.75 },
      now: {
        borderRadius: 12, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l1)', padding: '14px 16px', marginBottom: 22,
      },
      nowHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 },
      nowNum: { fontSize: 24, fontWeight: 650, fontVariantNumeric: 'tabular-nums' },
      nowLv: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' },
      bar: { height: 6, borderRadius: 4, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden', margin: '10px 0 12px' },
      fill: (pct) => ({
        height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`,
        background: pct < 25 ? 'var(--dsw-alias-state-error-primary)'
          : pct < 45 ? 'var(--dsw-alias-state-warning-primary)'
            : 'var(--dsw-alias-state-success-primary)',
      }),
      slots: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, fontSize: 12 },
      slot: { display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--dsw-alias-label-secondary)' },
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
      actions: {
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

    const pct = (v) => Math.round((Number(v) || 0) * 100)

    function EnergySettings() {
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
          h('h1', { style: T.h1 }, '人格电量'),
          h('p', { style: T.sub }, '正在读……')))
      }

      const snap = state.snapshot || null
      const groups = state.fields || []

      return h('div', { style: T.page }, h('div', { style: T.inner },
        h('h1', { style: T.h1 }, '人格电量'),
        h('p', { style: T.sub },
          '吃、睡、耗，压成一个 0..1 的数，取短板不取平均。',
          h('br'),
          '它决定「这一轮注入几成」，不是决定「话说多短」。'),

        snap
          ? h('div', { style: T.now },
            h('div', { style: T.nowHead },
              h('span', { style: T.nowNum }, pct(snap.energy)),
              h('span', { style: T.nowLv }, snap.level?.label || ''),
              snap.limiting ? h('span', { style: T.nowLv }, `卡在 ${snap.limiting}`) : null),
            h('div', { style: T.bar }, h('div', { style: T.fill(pct(snap.energy)) })),
            h('div', { style: T.slots },
              Object.entries(snap.slots || {}).map(([k, v]) =>
                h('div', { key: k, style: T.slot },
                  h('span', {}, k), h('span', {}, String(pct(v)))))),
          )
          : null,

        state.fileExists === false
          ? h('div', {
            style: {
              padding: '11px 14px', marginBottom: 18, borderRadius: 10, fontSize: 12.5, lineHeight: 1.7,
              border: '1px solid var(--dsw-alias-border-l1)',
              color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-l1)',
            },
          }, '还没有设置文件——现在用的是默认值。改一项再存，就会落成一份。')
          : null,

        ...groups.map((g, gi) => h('div', { key: `g${gi}`, style: T.section },
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
        )),

        h('div', { style: T.actions },
          h('button', { style: T.primary, disabled: busy || !dirty, onClick: save }, busy ? '存……' : '保存'),
          h('button', { style: T.ghost, disabled: busy, onClick: load }, '重新读'),
          dirty ? h('span', { style: T.dirty }, '有改动还没存') : null,
          saved ? h('span', { style: T.ok }, saved) : null,
          error ? h('span', { style: T.bad }, `没成：${error}`) : null,
        ),

        h('div', { style: T.footer },
          h('div', {}, `设置存在：${state.file || '（没找到可写位置）'}`),
          h('div', {}, '这几项每步现读，存完下一步就生效；不用重启。'),
        ),
      ))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona-energy',
          order: 45,
          label: '人格电量',
        }, EnergySettings))
      },
    }
  },
})

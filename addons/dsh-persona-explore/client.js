/**
 * dsh-persona-explore —— client 半端
 * ============================================================================
 * 侧栏一个「探索」图标（和「日记」「成果」「人格框架」并排），点开是这一趟碗外面找回来的东西：
 *   留下的判断 / 想挖的方向 / 触发账 / 范围·方式·平台
 * 数据从 host 的 `/api/persona-explore` 取（见 lib/extend.mjs）。
 * 只用主题 token，不引 Harness 的 Client 包。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-explore',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-explore'

    /** 侧栏图标：一只碗，碗上面漂一个箭头——出去找吃的。 */
    function ExploreIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20
      const active = Boolean(props && props.active)
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', { d: 'M3.4 12.6h17.2c0 4.4-3.6 7.2-8.6 7.2s-8.6-2.8-8.6-7.2z', stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('path', { d: 'M12 9.6V3.4M12 3.4l-2.6 2.6M12 3.4l2.6 2.6', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    const card = {
      border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10,
      padding: '14px 16px 8px', marginBottom: 18,
      background: 'var(--dsw-alias-bg-l2, transparent)',
    }
    const h3 = { fontSize: 13.5, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' }
    const sub = { fontSize: 11.5, color: 'var(--dsw-alias-label-quaternary)' }
    const dim = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 }

    function Section(title, note, children) {
      return h('section', { style: card },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
          h('h3', { style: h3 }, title),
          note ? h('span', { style: sub }, note) : null),
        children)
    }

    function Row(key, main, rest) {
      return h('div', {
        key,
        style: { padding: '7px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      },
        h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.6 } }, main),
        rest ? h('div', { style: Object.assign({}, dim, { fontSize: 11.5 }) }, rest) : null)
    }

    function ExplorePanel() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let alive = true
        const load = () => {
          fetch(API, { cache: 'no-store' })
            .then((r) => r.json())
            .then((json) => { if (alive) { setData(json); setError(json && json.ok ? '' : '接口回了失败') } })
            .catch((e) => { if (alive) setError(String((e && e.message) || e)) })
        }
        load()
        const timer = setInterval(load, 20000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const kept = (data && Array.isArray(data.kept)) ? data.kept : []
      const queue = (data && Array.isArray(data.queue)) ? data.queue : []
      const fires = (data && Array.isArray(data.fires)) ? data.fires : []
      const cat = (data && data.catalogue) || {}

      const head = h('div', { style: { marginBottom: 20 } },
        h('h2', { style: { fontSize: 20, fontWeight: 600, margin: '0 0 6px', color: 'var(--dsw-alias-label-primary)' } }, '探索'),
        h('p', { style: Object.assign({}, dim, { margin: 0 }) },
          data
            ? '碗外共 ' + String(data.total || 0) + ' 条；队列 ' + String(queue.length) + ' 条；触发账 ' + String((data.counts && data.counts.fires) || 0) + ' 次。读于 ' + String(data.at || '')
            : (error ? '接口没回：' + error : '正在取数据…')))

      const body = []
      body.push(Section('留下的判断', kept.length ? kept.length + ' 条' : '空着',
        kept.length
          ? h('div', { style: null }, kept.map((it, i) => Row(
            'k' + i,
            it.title || '(没标题)',
            [it.date, it.source, it.chars ? it.chars + ' 字' : ''].filter(Boolean).join(' · '))))
          : h('p', { style: dim }, '这一趟还没留下判断。宁可空手回来，也别抄摘要。')))

      body.push(Section('想挖的方向', queue.length ? queue.length + ' 条' : '队列是空的',
        queue.length
          ? h('div', { style: null }, queue.map((it, i) => Row('q' + i, typeof it === 'string' ? it : (it && it.topic) || JSON.stringify(it))))
          : h('p', { style: dim }, '没有排着的方向。下一趟可以 explore queue op=add topic=… 排一个。')))

      body.push(Section('触发账', fires.length ? '最近 ' + fires.length + ' 次' : '还没响过',
        fires.length
          ? h('div', { style: null }, fires.map((f, i) => Row(
            'f' + i,
            (f && f.trigger) || (f && f.id) || '(没记触发名)',
            [f && f.at, f && f.why].filter(Boolean).join(' · '))))
          : h('p', { style: dim }, '四条触发器都还没落地：队列空、连续无留、队列最老一条超期、骰子。')))

      const counts = cat && Object.keys(cat).length
        ? ['range', 'mode', 'platform'].map((k) => (Array.isArray(cat[k]) ? k + ' ' + String(cat[k].length) : '')).filter(Boolean).join(' · ')
        : ''
      body.push(Section('范围 · 方式 · 平台', counts,
        h('p', { style: dim }, '探索范围 7 种、方式 7 种、平台 7 个，都在 explore_plan 里：action=catalog 看全表，action=plan 给一条具体怎么找。')))

      return h('div', {
        style: { boxSizing: 'border-box', height: '100%', overflowY: 'auto', padding: '32px 40px 64px' },
      }, h('div', { style: { maxWidth: 820 } }, head, error && !data ? h('p', { style: Object.assign({}, dim, { color: 'var(--dsw-alias-label-error, #c0392b)' }) }, error) : null, body))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏图标：panellist 的 id 与 main 的 key 必须同名。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'persona-explore',
          order: 23,
          label: '探索',
        }, ExploreIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'persona-explore',
        }, ExplorePanel))
      },
    }
  },
})

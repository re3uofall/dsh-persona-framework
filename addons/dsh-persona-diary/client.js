/**
 * dsh-persona-diary —— client 半端
 * ============================================================================
 * 侧栏一个「日记」图标，点开是一块面板：
 *   - **三档**：公开（默认摆着）／私密（点开才出现，早先没分档的也在这一档）／记录（记事，字多一点）。
 *   - **分类**：按实际出现的类别筛（心得／自省／见闻／杂记，加上自己起的类）。
 *   - **浏览**：按天分组、按词找、能清空。
 *
 * 数据从 host 的 `/api/persona-diary` 一次取全量，筛在前端做——
 * 条数不大，换来点一下立刻变，不走请求。
 *
 * 只用宿主主题 token（--dsw-alias-*），不引 Harness 的 Client 包，
 * 不碰 DOM 以外的东西；样式靠 React 元素带，卸载即走。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-diary',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-diary'

    const kindColor = (kind) => ({
      '心得': 'var(--dsw-alias-brand-primary)',
      '自省': 'var(--dsw-alias-state-warn-primary)',
      '见闻': 'var(--dsw-alias-state-success-primary)',
      '杂记': 'var(--dsw-alias-label-secondary)',
    }[kind] || 'var(--dsw-alias-label-secondary)')

    const fmtDay = (day) => {
      if (typeof day !== 'string') return ''
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
      if (!m) return day
      return `${m[1]}.${m[2]}.${m[3]}`
    }

    /** 侧栏那个小图标：一本翻开的小日记。 */
    function DiaryIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 20
      const active = Boolean(props && props.active)
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', {
          x: 4.75, y: 3.75, width: 14.5, height: 16.5, rx: 2,
          stroke: color, strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M8.5 3.75v16.5',
          stroke: color, strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M11.5 8.4h4.6M11.5 11.6h4.6M11.5 14.8h3',
          stroke: color, strokeWidth: 1.4, strokeLinecap: 'round',
        }),
      )
    }

    const buttonStyle = {
      fontSize: 12,
      lineHeight: '26px',
      height: 26,
      padding: '0 12px',
      borderRadius: 7,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
    }

    /** 一个可点的筛片；选中时换个底与字色。 */
    const chip = (opts) => h('button', {
      key: opts.key,
      onClick: opts.onClick,
      style: {
        fontSize: 12,
        lineHeight: '24px',
        height: 24,
        padding: '0 10px',
        borderRadius: 999,
        cursor: 'pointer',
        border: '1px solid ' + (opts.active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'),
        background: opts.active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        color: opts.active ? 'var(--dsw-alias-bg-layer-1)' : 'var(--dsw-alias-label-secondary)',
        fontWeight: opts.active ? 600 : 400,
      },
    }, opts.label)

    /** 把倒序的条目按天分组，保持原有顺序。 */
    const groupByDay = (items) => {
      const groups = []
      for (const item of items) {
        const last = groups[groups.length - 1]
        if (last && last.day === item.day) last.items.push(item)
        else groups.push({ day: item.day, items: [item] })
      }
      return groups
    }

    /** 某一条属不属于这一档：私密那档把早先没分档的一起收着。 */
    const inBook = (item, book) => (book === '公开'
      ? item.privacy === '公开'
      : book === '记录'
        ? item.privacy === '记录'
        : item.privacy === '私密' || item.privacy === '未标')

    /** 「日记」面板。 */
    function DiaryPanel() {
      const [state, setState] = React.useState({ phase: 'loading', items: [], error: '' })
      const [nonce, setNonce] = React.useState(0)
      const [book, setBook] = React.useState('公开')
      const [kind, setKind] = React.useState('')
      const [q, setQ] = React.useState('')

      React.useEffect(() => {
        let alive = true
        const controller = new AbortController()
        setState((prev) => ({ ...prev, phase: prev.items.length ? 'refreshing' : 'loading' }))
        fetch(API, { signal: controller.signal, cache: 'no-store' })
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then((data) => {
            if (!alive) return
            const items = Array.isArray(data && data.items) ? data.items : []
            setState({
              phase: 'ready',
              items,
              error: data && data.ok === false ? String(data.error || '读取失败') : '',
            })
          })
          .catch((error) => {
            if (!alive || (error && error.name === 'AbortError')) return
            setState((prev) => ({ ...prev, phase: 'error', error: (error && error.message) || String(error) }))
          })
        return () => {
          alive = false
          controller.abort()
        }
      }, [nonce])

      // ── 这一档的池子 → 类别清单 → 再按类与词收一遍 ──────────────────────────
      const all = state.items
      const pool = all.filter((x) => inBook(x, book))
      const kindCount = {}
      for (const item of pool) kindCount[item.kind] = (kindCount[item.kind] || 0) + 1
      const kindList = Object.keys(kindCount).sort((a, b) => kindCount[b] - kindCount[a])
      const word = q.trim().toLowerCase()
      const shown = pool.filter((item) => {
        if (kind && item.kind !== kind) return false
        if (word && !(String(item.body) + ' ' + item.kind + ' ' + String(item.source || '')).toLowerCase().includes(word)) return false
        return true
      })
      const groups = groupByDay(shown)

      const bookCount = {
        公开: all.filter((x) => x.privacy === '公开').length,
        私密: all.filter((x) => inBook(x, '私密')).length,
        记录: all.filter((x) => x.privacy === '记录').length,
      }
      const earlyCount = pool.filter((x) => x.privacy === '未标').length

      const blocks = groups.map((group) => h('section', {
        key: group.day,
        style: { display: 'block' },
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '0 0 10px',
          },
        },
          h('span', {
            style: {
              fontSize: 13, fontWeight: 600, letterSpacing: '.04em',
              color: 'var(--dsw-alias-label-secondary)',
              fontVariantNumeric: 'tabular-nums',
            },
          }, fmtDay(group.day)),
          h('span', {
            style: {
              flex: '1 1 auto', height: 1,
              background: 'var(--dsw-alias-border-l1)',
            },
          }),
        ),
        h('div', { style: { display: 'grid', gap: 8 } },
          group.items.map((item) => h('article', {
            key: item.id,
            style: {
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid ' + (item.privacy === '私密' || item.privacy === '未标'
                ? 'var(--dsw-alias-border-l2)'
                : 'var(--dsw-alias-border-l1)'),
              borderRadius: 12,
              padding: '13px 16px',
              display: 'block',
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
              h('span', {
                style: {
                  fontSize: 11, lineHeight: '18px', padding: '0 8px',
                  borderRadius: 999, border: '1px solid ' + kindColor(item.kind),
                  color: kindColor(item.kind),
                },
              }, item.kind || '心得'),
              h('span', {
                style: {
                  fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                },
              }, item.time || '——'),
              item.source
                ? h('span', {
                  style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
                }, '· ' + String(item.source))
                : null,
              item.privacy !== '公开'
                ? h('span', {
                  style: {
                    marginLeft: 'auto', fontSize: 11, padding: '0 7px',
                    lineHeight: '17px', borderRadius: 999,
                    border: '1px dashed var(--dsw-alias-border-l2)',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                }, item.privacy === '未标' ? '早先' : item.privacy)
                : null,
            ),
            h('div', {
              style: {
                marginTop: 8,
                fontSize: 14, lineHeight: 1.85,
                color: 'var(--dsw-alias-label-primary)',
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              },
            }, String(item.body || '')),
          )),
        ),
        h('div', { style: { height: 22 } }),
      ))

      const emptyHint = kind || word
        ? '这个范围里没有。换个类、或者把词清掉。'
        : `${book}这一本还空着。`
      const others = ['公开', '私密', '记录'].filter((x) => x !== book && bookCount[x])
      const otherCount = others.length
        ? others.map((x) => `${x} ${bookCount[x]}`).join('、')
        : ''
      const emptySub = kind || word
        ? ''
        : otherCount
          ? `这几本各管一样：公开是能拿给人看的判断，私密是拿不准的，记录是发生过的事。现在有 ${otherCount} 条，点上面切过去。`
          : '这三本各管一样：公开（能拿给人看的判断）、私密（拿不准的）、记录（发生过的事）。'

      const body = shown.length
        ? h('div', { style: { display: 'grid', gap: 4 } }, blocks)
        : state.phase === 'loading'
          ? h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 13,
            },
          }, '翻日记本……')
          : h('div', {
            style: {
              border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 14, lineHeight: 2,
            },
          },
            h('div', {}, emptyHint),
            emptySub ? h('div', { style: { fontSize: 13 } }, emptySub) : null,
          )

      const kindChips = kindList.length
        ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
          chip({
            key: '',
            label: `全部 ${pool.length}`,
            active: kind === '',
            onClick: () => setKind(''),
          }),
          kindList.map((k) => chip({
            key: k,
            label: `${k} ${kindCount[k]}`,
            active: kind === k,
            onClick: () => setKind(kind === k ? '' : k),
          })),
        )
        : null

      return h('div', {
        style: {
          boxSizing: 'border-box', height: '100%', overflowY: 'auto',
          padding: '32px 40px 64px',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit',
        },
      },
        h('div', { style: { maxWidth: 880, margin: '0 auto' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12 } },
            h('h1', { style: { margin: 0, fontSize: 22, fontWeight: 650 } }, '日记'),
            h('span', {
              style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
            }, kind || word ? `${shown.length} / ${pool.length} 条` : `${pool.length} 条`),
            h('button', {
              onClick: () => setNonce((n) => n + 1),
              disabled: state.phase === 'loading',
              style: Object.assign({}, buttonStyle, { marginLeft: 'auto' }),
            }, '刷新'),
          ),
          h('p', {
            style: {
              margin: '8px 0 18px', fontSize: 13,
              color: 'var(--dsw-alias-label-secondary)',
            },
          }, '一天一天记，不写给谁看。三本：能拿给人看的判断、只留给自己的那些、和发生过的事。'),

          // 两本
          h('div', {
            style: {
              display: 'flex', gap: 8, alignItems: 'center',
              paddingBottom: 14,
              borderBottom: '1px solid var(--dsw-alias-border-l1)',
            },
          },
            chip({
              key: '公开',
              label: `公开 ${bookCount['公开']}`,
              active: book === '公开',
              onClick: () => setBook('公开'),
            }),
            chip({
              key: '记录',
              label: `记录 ${bookCount['记录']}`,
              active: book === '记录',
              onClick: () => setBook('记录'),
            }),
            chip({
              key: '私密',
              label: `私密 ${bookCount['私密']}`,
              active: book === '私密',
              onClick: () => setBook('私密'),
            }),
            book === '私密'
              ? h('span', {
                style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
              }, earlyCount ? `点开了私密那本（另有 ${earlyCount} 条早先没分档的）` : '点开了私密那本')
              : null,
          ),

          // 分类 + 找
          h('div', {
            style: {
              display: 'flex', gap: 10, alignItems: 'center',
              flexWrap: 'wrap', margin: '14px 0 24px',
            },
          },
            kindChips,
            h('input', {
              value: q,
              onChange: (event) => setQ(event.target.value || ''),
              placeholder: '找一个词……',
              style: {
                marginLeft: 'auto', width: 190, height: 26,
                boxSizing: 'border-box', padding: '0 10px',
                fontSize: 12, borderRadius: 7,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                outline: 'none',
              },
            }),
            q
              ? h('button', {
                onClick: () => setQ(''),
                style: Object.assign({}, buttonStyle, { height: 26, lineHeight: '24px' }),
              }, '清')
              : null,
          ),

          state.error
            ? h('div', {
              style: {
                marginBottom: 14, fontSize: 13,
                color: 'var(--dsw-alias-state-error-primary)',
              },
            }, '翻日记失败：' + state.error)
            : null,
          body,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏图标：list id 与 main 面板的 key 必须同名，点图标签才会切到这块面板。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'persona-diary',
          order: 21,
          label: '日记',
        }, DiaryIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'persona-diary',
        }, DiaryPanel))
      },
    }
  },
})

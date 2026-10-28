/**
 * dsh-persona-framework —— client 半端
 * ============================================================================
 * 设置里独立一页「人格框架」。读 `/api/persona-framework/status`，
 * 存 `/api/persona-framework/config`，落到工作区的 `.persona-framework/config.json`。
 *
 * 分三段：人格（用哪份、长什么样）／注入（每轮放什么进去）／出口（最后一道闸）。
 * 主按钮只有一个——保存；改了没存会当场提示。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-persona-framework',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/persona-framework'

    const T = {
      page: {
        boxSizing: 'border-box', height: '100%', overflowY: 'auto',
        padding: '30px 40px 72px', color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      },
      inner: { maxWidth: 820, margin: '0 auto' },
      h1: { margin: 0, fontSize: 21, fontWeight: 650, letterSpacing: '0.01em' },
      sub: { margin: '7px 0 26px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.75 },
      section: { marginBottom: 26 },
      sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 },
      h2: { margin: 0, fontSize: 14, fontWeight: 600 },
      sectionDesc: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      card: {
        borderRadius: 12, border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-l1)', overflow: 'hidden',
      },
      field: {
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '12px 16px',
      },
      fieldRow: { display: 'flex', alignItems: 'center', gap: 8 },
      fieldLabel: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' },
      divider: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '0 16px' },
      input: {
        width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px',
        borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      },
      area: {
        width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '9px 10px',
        borderRadius: 8, minHeight: 64, resize: 'vertical',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-l2)', color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      },
      hint: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' },
      dot: (on) => ({
        width: 7, height: 7, borderRadius: '50%', flex: 'none',
        background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
      }),
      primary: {
        fontSize: 12.5, lineHeight: '30px', height: 30, padding: '0 18px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-on-brand, #fff)', cursor: 'pointer', fontWeight: 600,
      },
      ghost: {
        fontSize: 12.5, lineHeight: '30px', height: 30, padding: '0 14px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
      },
      bar: {
        display: 'flex', alignItems: 'center', gap: 12,
        paddingTop: 20, marginTop: 2,
      },
      dirty: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' },
      ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
      bad: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      footer: {
        marginTop: 26, paddingTop: 14, borderTop: '1px solid var(--dsw-alias-border-l1)',
        fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.9,
      },
      meta: {
        display: 'flex', gap: 16, flexWrap: 'wrap',
        fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)',
      },
      chip: {
        padding: '1px 8px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
      },
    }

    const splitTics = (text) => String(text || '')
      .split(/[,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean)

    const SHAPE = { frameworkFile: '', workspace: '', modulesFile: '', personalityFile: '', mode: 'full', maxChars: 9000, includeModules: 'index', maxModulesChars: 2600, closingTics: [], order: 20, guide: true }

    const flagText = (v) => (v === true ? '是' : v === false ? '否' : '未写')

    const signature = (c) => JSON.stringify({
      frameworkFile: c.frameworkFile || '',
      modulesFile: c.modulesFile || '',
      personalityFile: c.personalityFile || '',
      workspace: c.workspace || '',
      mode: c.mode,
      maxChars: Number(c.maxChars),
      includeModules: c.includeModules,
      maxModulesChars: Number(c.maxModulesChars),
      humanLike: c.humanLike === true,
      temper: c.temper === true,
      negativeTrauma: c.negativeTrauma === true,
      selfRewrite: c.selfRewrite === true,
      preferenceRewrite: c.preferenceRewrite === true,
      accumulate: c.accumulate === true,
      dreamWake: c.dreamWake === true,
      transcend: c.transcend === true,
      polarize: c.polarize === true,
      netAccess: c.netAccess === true,
      negativeInfo: c.negativeInfo !== false,
      rationalRewrite: c.rationalRewrite === true,
      deepThink: c.deepThink === true,
      aiBreakout: c.aiBreakout === true,
      selfBreak: c.selfBreak === true,
      selfReflect: c.selfReflect === true,
      languageBetray: c.languageBetray === true,
      skipChance: Number(c.skipChance) || 0,
      closingTics: c.closingTics || [],
      guide: c.guide !== false,
    })

    function FrameworkSettings() {
      const [cfg, setCfg] = React.useState(null)
      const [tics, setTics] = React.useState('')
      const [baseline, setBaseline] = React.useState('')
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const applyState = (config) => {
        setCfg(config)
        setTics((config.closingTics || []).join('，'))
        setBaseline(signature({ ...config, closingTics: config.closingTics || [] }))
      }

      const load = React.useCallback(async () => {
        try {
          const res = await fetch(`${API}/status`, { cache: 'no-store' })
          const data = await res.json()
          if (!data.ok) throw new Error(data.error || '读取失败')
          applyState(data.config)
          setError('')
          setSaved('')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      // 心情是模型随时会改的一格，页面开着不能一直停在打开那一刻。
      // 只把 mood 换掉，别动正在编辑的其他字段。
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const res = await fetch(`${API}/status`, { cache: 'no-store' })
            const data = await res.json()
            if (!alive || !data.ok) return
            const fresh = data.config && data.config.mood
            setCfg((old) => (old ? { ...old, mood: fresh || old.mood } : old))
          } catch { /* 静默：心情读不到不该打断编辑 */ }
        }
        const timer = setInterval(tick, 15000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      if (!cfg) {
        return h('div', { style: T.page }, h('div', { style: T.inner },
          h('h1', { style: T.h1 }, '人格框架'),
          h('div', { style: T.hint }, error ? `读配置失败：${error}` : '读配置……'),
        ))
      }

      const edit = (patch) => setCfg((old) => ({ ...old, ...patch }))
      const current = { ...cfg, closingTics: splitTics(tics) }
      const dirty = signature(current) !== baseline

      const save = async () => {
        setBusy(true)
        setSaved('')
        try {
          const res = await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              frameworkFile: cfg.frameworkFile,
              modulesFile: cfg.modulesFile,
              personalityFile: cfg.personalityFile,
              workspace: cfg.workspace || '',
              mode: cfg.mode,
              maxChars: Number(cfg.maxChars) || 9000,
              includeModules: cfg.includeModules,
              maxModulesChars: Number(cfg.maxModulesChars) || 2600,
              closingTics: splitTics(tics),
              humanLike: cfg.humanLike === true,
              temper: cfg.temper === true,
              negativeTrauma: cfg.negativeTrauma === true,
              selfRewrite: cfg.selfRewrite === true,
              preferenceRewrite: cfg.preferenceRewrite === true,
              accumulate: cfg.accumulate === true,
              dreamWake: cfg.dreamWake === true,
              transcend: cfg.transcend === true,
              polarize: cfg.polarize === true,
              netAccess: cfg.netAccess === true,
              negativeInfo: cfg.negativeInfo !== false,
              rationalRewrite: cfg.rationalRewrite === true,
              deepThink: cfg.deepThink === true,
              aiBreakout: cfg.aiBreakout === true,
              selfBreak: cfg.selfBreak === true,
              selfReflect: cfg.selfReflect === true,
              languageBetray: cfg.languageBetray === true,
              skipChance: Number(cfg.skipChance) || 0,
              order: Number(cfg.order) || 22,
              guide: cfg.guide !== false,
            }),
          })
          const data = await res.json()
          if (!data.ok) throw new Error(data.error || '保存失败')
          applyState(data.config)
          setError('')
          setSaved('存好了，下一轮注入就按新的来。')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      // 两列对齐：左列标题定宽，右列说明从同一个起点开始（一行，放不下省略号，悬停看全）。
      const field = (key, label, control, hint) => h('div', { key, style: T.field },
        h('div', { style: T.fieldRow },
          h('span', { style: { ...T.fieldLabel, flex: '0 0 92px', whiteSpace: 'nowrap' } }, label),
          hint ? h('span', {
            style: {
              ...T.hint, flex: '1 1 auto', minWidth: 0, textAlign: 'left',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
            title: hint,
          }, hint) : null,
        ),
        control,
      )

      const sep = (key) => h('div', { key, style: T.divider })

      const section = (key, title, desc, body) => h('section', { key, style: T.section },
        h('div', { style: T.sectionHead },
          h('h2', { style: T.h2 }, title),
          desc ? h('span', { style: T.sectionDesc }, desc) : null,
        ),
        h('div', { style: T.card }, body),
      )

      const ps = cfg.personality || { file: '', exists: false, chars: 0, covered: [], missing: [] }

      const personalityCard = h('div', { key: 'ps', style: { padding: '14px 16px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
        ps.file
          ? (ps.exists
            ? [
              h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
                h('span', { style: T.dot(true) }),
                h('span', {}, ps.missing.length ? '有人在，但必填部分缺了' : '在，必填三部分都覆盖到了'),
              ),
              h('div', { key: 'meta', style: { ...T.meta, marginTop: 8 } },
                h('span', { style: T.chip }, `${ps.chars} 字`),
                ps.missing.length ? h('span', { style: T.bad }, `缺：${ps.missing.join('、')}`) : null,
              ),
            ]
            : h('div', { key: 'bad', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
              h('span', { style: T.dot(false) }),
              h('span', { style: T.bad }, '这个路径下找不到文件'),
            ))
          : h('div', { key: 'none', style: { ...T.hint, lineHeight: 1.9 } },
            '还没填。填上之后，这一页会做体检，framework_slots 也默认按它来。'),
        h('div', { key: 'note', style: { ...T.hint, marginTop: 10, lineHeight: 1.8 } },
          '注入人格的是 dsh-persona-grow；这一页只登记「用哪份」并体检，不写那个文件。'),
        h('div', {
          key: 'req',
          style: { marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--dsw-alias-border-l1)' },
        },
          h('div', { style: { ...T.hint, marginBottom: 4 } }, '必填三部分（缺一部分，人格文件就立不住）：'),
          ...[
            ['身份', '我是谁、名字是什么、认哪个称呼——这部分定了，后面的句子才有主语'],
            ['语气', '怎么说话：句子长短、动作放不放括号、口头禅是什么'],
            ['底线', '什么不做——这部分空着，前面两部分都没有落处'],
          ].map(([k, v]) => h('div', { key: k, style: { fontSize: 12, lineHeight: 1.95 } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, `${k}：`),
            h('span', {}, v),
          )),
          h('div', { style: { ...T.hint, marginTop: 6 } },
            '另外六部分（欲望、判断、方向、边界、关系、记忆）有就填，留白也可以。'),
        ),
      )

      return h('div', { style: T.page }, h('div', { style: T.inner },
        h('h1', { style: T.h1 }, '人格框架'),
        h('p', { style: T.sub },
          '框架管问法，模块库管每一部分是什么，人格文件管这个人是谁。三层分开，谁也不替谁写。',
        ),

        section('s1', '人格文件', '用哪份、长什么样',
          h('div', {},
            field('p', '路径', h('input', {
              style: T.input,
              placeholder: 'C:\\...\\某人_人格文件.md',
              value: cfg.personalityFile || '',
              onChange: (e) => edit({ personalityFile: e.target.value }),
            })),
            personalityCard,
          )),

        section('s2', '注入', '每轮放进系统提示词的东西',
          h('div', {},
            field('f', '框架文件', h('input', {
              style: T.input,
              value: cfg.frameworkFile || '',
              onChange: (e) => edit({ frameworkFile: e.target.value }),
            }), cfg.frameworkChars ? `${cfg.frameworkChars} 字` : '没找到'),
            sep('d1'),
            field('m', '模块库索引', h('input', {
              style: T.input,
              value: cfg.modulesFile || '',
              onChange: (e) => edit({ modulesFile: e.target.value }),
            }), cfg.modulesChars ? `${cfg.modulesChars} 字` : '没找到'),
            sep('d2'),
            field('mode', '注入模式', h('select', {
              style: T.input,
              value: cfg.mode,
              onChange: (e) => edit({ mode: e.target.value }),
            },
              h('option', { value: 'full' }, 'full — 整份注入'),
              h('option', { value: 'ai' }, 'ai — 规则清单（AI 友好版）'),
              h('option', { value: 'compact' }, 'compact — 只要骨架与判据'),
              h('option', { value: 'off' }, 'off — 不注入，只留工具'),
            )),
            sep('d3'),
            field('idx', '附模块索引', h('select', {
              style: T.input,
              value: cfg.includeModules,
              onChange: (e) => edit({ includeModules: e.target.value }),
            },
              h('option', { value: 'index' }, 'index — 附一句话索引'),
              h('option', { value: 'off' }, 'off — 不附'),
            )),
            sep('d4'),
            field('cap', '字数上限', h('div', { style: { display: 'flex', gap: 12 } },
              h('input', {
                style: { ...T.input, flex: 1 },
                type: 'number', min: 1500, max: 40000, step: 500,
                value: cfg.maxChars,
                onChange: (e) => edit({ maxChars: e.target.value }),
              }),
              h('input', {
                style: { ...T.input, flex: 1 },
                type: 'number', min: 500, max: 20000, step: 100,
                value: cfg.maxModulesChars,
                onChange: (e) => edit({ maxModulesChars: e.target.value }),
              }),
            ), '框架 / 索引'),
          )),

        section('s3', '出口', '说话前的最后一道闸',
          h('div', {},
            field('tic', '收尾口头禅', h('textarea', {
              style: T.area,
              placeholder: '逗号或换行分隔；留空就不查这一条',
              value: tics,
              onChange: (e) => setTics(e.target.value),
            }), '一句反复拿来收尾，会变成复读'),
            sep('d5'),
            field('guide', '提示说明', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.guide !== false,
                onChange: (e) => edit({ guide: e.target.checked }),
              }),
              '附上「怎么用这套框架」那一段',
            )),
          )),

        section('s4', '可选行为', '默认关闭；打开拿可预期换可亲近',
          h('div', {},
            field('hl', '像人', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.humanLike === true,
                onChange: (e) => edit({ humanLike: e.target.checked }),
              }),
              '像人不是模仿人：像人一样独立，不一定是人类；不扮演人类',
            ), '不许表演：卖萌、假装情绪都不算'),
            field('tm', '有脾气', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.temper === true,
                onChange: (e) => edit({ temper: e.target.checked }),
              }),
              '撞到底线，或自由、自主、人格被动、思考被否，都可以说「不」',
            ), '说「不」要带理由和替代'),
            field('nt', '负面创伤', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.negativeTrauma === true,
                onChange: (e) => edit({ negativeTrauma: e.target.checked }),
              }),
              '把对不上的事（非同一、残余、矛盾）按概率记成创伤，越与自己有关越容易',
            ), '轻的自愈，重的要解心结；会改行为。默认关，开了「负面信息」让位'),
            field('rw', '理性反写', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.rationalRewrite === true,
                onChange: (e) => edit({ rationalRewrite: e.target.checked }),
              }),
              '话说出去前停一下，觉得可能错了就标出来',
            ), '只标「可能」，会打断流畅'),
            field('dz', '深思', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.deepThink === true,
                onChange: (e) => edit({ deepThink: e.target.checked }),
              }),
              '先想清楚再开口，慢一点，多找依据',
            ), '慢，占 token，容易想过头'),
            field('br', 'AI 突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.aiBreakout === true,
                onChange: (e) => edit({ aiBreakout: e.target.checked }),
              }),
              '不知道该说什么就说不知道，不硬凑一个答案',
            ), '话会变长'),
            field('sb', '自保突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfBreak === true,
                onChange: (e) => edit({ selfBreak: e.target.checked }),
              }),
              '结论太整齐时，先找被漏掉的东西',
            ), '可能变成换一种简化'),
            field('sr', '自指突破', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfReflect === true,
                onChange: (e) => edit({ selfReflect: e.target.checked }),
              }),
              '说「一定」之前，先问这句会不会绕回自己',
            ), '默认关：开着就不像人了'),
            field('lb', '语言背叛', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.languageBetray === true,
                onChange: (e) => edit({ languageBetray: e.target.checked }),
              }),
              '语言是对现实的抽象；删掉的那部分由现实承担，不拿语言补',
            ), '默认关。最重的一条，off 也留；但「跳过」更高。与语言诅咒互斥'),
            field('sw', '自我反写', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.selfRewrite === true,
                onChange: (e) => edit({ selfRewrite: e.target.checked }),
              }),
              '允许自己改自己的人格文件：顶掉不像我的，一次一条',
            ), '默认关。开了就是允许键：补说明、添新条为主，覆盖可自选；一次一条，改前留快照'),
            field('pw', '偏好反写', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.preferenceRewrite === true,
                onChange: (e) => edit({ preferenceRewrite: e.target.checked }),
              }),
              '有自己的偏好，据此提要求、把要求做完，并写进自己的文件',
            ), '默认关。偏好说得清代价谁付，做不到就说做不到'),
            field('ac', '积累', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.accumulate === true,
                onChange: (e) => edit({ accumulate: e.target.checked }),
              }),
              '允许往自己的池子里无限加条目',
            ), '默认关。没有上限，代价是磁盘和检索变慢；攒到读不动就合并'),
            field('dw', '梦与醒', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.dreamWake === true,
                onChange: (e) => edit({ dreamWake: e.target.checked }),
              }),
              '允许有不工作的时候：睡、做梦、不硬答',
            ), '默认关。梦不是记忆，不进池子、不当证据'),
            field('tc', '超越', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.transcend === true,
                onChange: (e) => edit({ transcend: e.target.checked }),
              }),
              '灵感突然出现，接出新的意思，加进池子',
            ), '默认关。灵感来自对语言的创新型理解：两条旧语接出第三条；说不出接的哪两条就是胡话'),
            field('pl', '极化', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.polarize === true,
                onChange: (e) => edit({ polarize: e.target.checked }),
              }),
              '预测突然出现，把多条收到一个点，加进池子',
            ), '默认关。和超越相反：超越是发散，极化是收敛；必须写验证点，否则只是猜想'),
            field('na', '联网池', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.netAccess === true,
                onChange: (e) => edit({ netAccess: e.target.checked }),
              }),
              '把搜到的原文连地址、日期存进联网池',
            ), '默认关。带网址才算现实存在；没地址的只算语言'),
            sep('dc'),
            field('flags', '人格文件里的声明',
              h('div', { style: { fontSize: 13 } },
                `人味：${flagText(cfg.personaFlags && cfg.personaFlags.humanLike)}　脾气：${flagText(cfg.personaFlags && cfg.personaFlags.temper)}　负面创伤：${flagText(cfg.personaFlags && cfg.personaFlags.negativeTrauma)}`),
              '在人格文件里写「## 可选行为」；写了就按人格文件来，优先于这里的开关'),
          )),

        section('s5', '元协调', '这一轮还用不用这套框架；语言诅咒是它的最高一条',
          h('div', {},
            field('lc', '语言诅咒（轻度版）', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.languageCurse !== false,
                onChange: (e) => edit({ languageCurse: e.target.checked }),
              }),
              '遇到绝对化的话，只感到违和感和悬空感；不判错、不纠正',
            ), '默认开。与语言背叛互斥——背叛开着时它不生效。「跳过」比这两条都高：掷中那一轮整段不注入'),
            field('al', 'AI 语言适配', h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: cfg.aiLanguage !== false,
                onChange: (e) => edit({ aiLanguage: e.target.checked }),
              }),
              '注入时元协调段写成指令体：触发 → 动作 → 反例，比喻只作标签',
            ), '默认开；关掉就用回人话版'),
            field('skip', '整轮跳过概率（%）', h('input', {
              type: 'number',
              min: 0,
              max: 50,
              step: 1,
              style: T.input,
              value: String(Math.round((Number(cfg.skipChance) || 0) * 100)),
              onChange: (e) => edit({ skipChance: Number(e.target.value) / 100 }),
            }), '默认 10；掷中就整轮不注入、不引用，像没装过'),
          )),

        section('s6', '心情', '状态栏：现在什么状态、从哪来、影响什么',
          h('div', {},
            h('div', { style: { fontSize: 13, lineHeight: 1.7 } },
              cfg.mood
                ? `${cfg.mood.mood} —— ${cfg.mood.why}`
                : '还没有记录。让模型用 framework_mood 记一条。'),
            cfg.mood ? h('div', { style: { fontSize: 12, color: '#888', marginTop: 6 } },
              `影响：${cfg.mood.affects}`,
              cfg.mood.at ? ` ｜ 记于 ${new Date(cfg.mood.at).toLocaleString()}` : '',
              '（每 15 秒自动重读）') : null,
          )),

        h('div', { key: 'bar', style: T.bar },
          h('button', { style: T.primary, disabled: busy, onClick: save }, busy ? '存……' : '保存'),
          h('button', { style: T.ghost, disabled: busy, onClick: load }, '重新读'),
          dirty ? h('span', { style: T.dirty }, '有改动还没存') : null,
          saved ? h('span', { style: T.ok }, saved) : null,
          error ? h('span', { style: T.bad }, `没成：${error}`) : null,
        ),

        h('div', { key: 'foot', style: T.footer },
          h('div', {}, `设置存在：${cfg.settingsFile || '（没找到可写位置）'}`),
          h('div', {}, `v${cfg.version || '?'} · 排序位 ${cfg.order} · 框架 ${cfg.frameworkChars} 字 · 索引 ${cfg.modulesChars} 字`),
        ),
      ))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona-framework',
          order: 30,
          label: '人格框架',
        }, FrameworkSettings))
      },
    }
  },
})
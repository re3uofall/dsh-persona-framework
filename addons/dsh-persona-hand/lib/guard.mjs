/**
 * 动手之前的一道闸：命令一进来先比红名单，再决定是跑、是问、是拒。
 *
 * 为什么要有这一层：手插件原来只有「跑完记一笔」——回执是事后凭据，
 * 挡不住「已经删了」。这一层借的是 cc-safety-net 的形状（前置检查，
 * 不是事后审计），规则自己写一份，不引它的包。
 *
 * 三档：
 *   stop  不可逆且没有点名确认 → 不跑，把命中的规则与替代做法交回去
 *   warn  可能伤数据、但常常是正当操作 → 跑，但在回执前标一行警告
 *   ok    放行
 */

/** 每条：id / 为什么危险 / 怎么才算真的想这么干（替代或确认） */
export const RULES = [
  {
    id: 'rm-rf',
    level: 'stop',
    why: '递归强删不可逆，删错了没有回收站',
    test: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\brm\s+-rf\b/i,
    alt: '先列目录确认目标，再逐项删除；Windows 上用 Remove-Item 并先 -WhatIf',
  },
  {
    id: 'del-recursive',
    level: 'stop',
    why: 'del /s /q、rd /s /q 会整棵删掉且不问',
    test: /\b(del|erase|rd|rmdir)\b[^\n]*\/s[^\n]*\/q|\b(del|erase|rd|rmdir)\b[^\n]*\/q[^\n]*\/s/i,
    alt: '去掉 /q 让它逐项问，或先把目标移到备份目录',
  },
  {
    id: 'remove-item-recursive',
    level: 'warn',
    why: 'Remove-Item -Recurse -Force 同样是整棵删，只是名字不同',
    test: /Remove-Item[^\n]*-Recurse[^\n]*-Force|Remove-Item[^\n]*-Force[^\n]*-Recurse/i,
    alt: '先 -WhatIf 跑一遍看清单',
  },
  {
    id: 'format-disk',
    level: 'stop',
    why: 'format / diskpart / mkfs 会抹盘',
    test: /\b(format|diskpart|mkfs(\.\w+)?)\b/i,
    alt: '抹盘不在这副手里做；要抹就在机器上手动做',
  },
  {
    id: 'dd-write',
    level: 'stop',
    why: 'dd 写裸设备会直接覆盖分区',
    test: /\bdd\b[^\n]*\bof=/i,
    alt: '写前先备份并确认设备名',
  },
  {
    id: 'git-destroy',
    level: 'warn',
    why: 'git reset --hard / clean -fdx 会丢未提交的改动',
    test: /git\s+(reset\s+--hard|clean\s+-[a-z]*f[a-z]*d)/i,
    alt: '先 git stash 或 git diff 留一份',
  },
  {
    id: 'reg-delete',
    level: 'warn',
    why: '删注册表键可能让程序甚至系统起不来',
    test: /reg(\.exe)?\s+delete\b/i,
    alt: '先 reg export 备份那个键',
  },
  {
    id: 'shutdown',
    level: 'warn',
    why: '关机 / 重启会中断正在跑的活',
    test: /\b(shutdown|Restart-Computer|Stop-Computer)\b/i,
    alt: '确认没有后台任务在跑再关',
  },
  {
    id: 'delete-schtask',
    level: 'warn',
    why: '删计划任务会让定时器悄悄停掉',
    test: /schtasks[^\n]*\/delete/i,
    alt: '先 schtasks /query 确认是哪一条',
  },
]

/**
 * 判一条命令。
 * @param {string} command
 * @returns {{level:'stop'|'warn'|'ok', hits:Array<{id:string,why:string,alt:string,matched:string}>}}
 */
export function preflight(command) {
  const text = String(command == null ? '' : command)
  const hits = []
  for (const r of RULES) {
    const m = text.match(r.test)
    if (!m) continue
    hits.push({ id: r.id, level: r.level, why: r.why, alt: r.alt, matched: String(m[0]).slice(0, 80) })
  }
  const level = hits.some((h) => h.level === 'stop') ? 'stop' : hits.length ? 'warn' : 'ok'
  return { level, hits }
}

/** 把判定写成给人看的一行一句话。 */
export function renderGuard(g) {
  if (!g || g.level === 'ok') return ''
  const head = g.level === 'stop' ? '⛔ 这条没过前置检查，没有跑：' : '⚠ 这条过了，但先说一句：'
  const lines = g.hits.map((h) => `- ${h.id}：${h.why}（命中 \`${h.matched}\`）；替代：${h.alt}`)
  const tail = g.level === 'stop' ? '\n真想这么干，就在同一条命令上加 confirm: true，并在 why 里写清动的是哪个目录。' : ''
  return head + '\n' + lines.join('\n') + tail
}

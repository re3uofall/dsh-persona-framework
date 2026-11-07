// 自检：只测纯逻辑与临时 profile，不碰真的 profile。
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as prof from './lib/profile.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

// 1. 包名解析
ok('pkgNameOf 普通名', prof.pkgNameOf('dsh-persona-hand') === 'dsh-persona-hand')
ok('pkgNameOf 带版本', prof.pkgNameOf('dsh-persona-hand@1.2.3') === 'dsh-persona-hand')
ok('pkgNameOf scope', prof.pkgNameOf('@scope/pkg@0.1.0') === '@scope/pkg')

// 2. 临时 profile
const tmp = mkdtempSync(join(tmpdir(), 'mod29-'))
const pkg = join(tmp, 'package.json')
writeFileSync(pkg, JSON.stringify({
  name: 'tmp-profile',
  dependencies: { 'a-pack': '1.0.0' },
  dsh: { profile: { bundles: ['a-pack'] } },
}, null, 2))

const r = prof.readProfile({ profile: tmp })
ok('readProfile 读得到', r.ok && r.json.name === 'tmp-profile')
ok('bundlesOf 读到 a-pack', prof.bundlesOf(r.json).includes('a-pack'))
ok('list 统计 1 个依赖 1 个启用', (() => { const l = prof.list({ profile: tmp }); return l.ok && l.deps === 1 && l.bundles === 1 })())

// 3. 停用：写前留 .bak，写完回读
const off = prof.setEnabled('a-pack', false, { profile: tmp })
ok('停用 ok', off.ok === true)
ok('停用后 bundles 空', prof.bundlesOf(prof.readProfile({ profile: tmp }).json).length === 0)
ok('停用留了 .bak', (() => { try { return readFileSync(pkg + '.bak', 'utf8').includes('a-pack') } catch { return false } })())

// 4. 再启用
const on = prof.setEnabled('a-pack', true, { profile: tmp })
ok('启用 ok', on.ok === true)
ok('启用后 bundles 有 a-pack', prof.bundlesOf(prof.readProfile({ profile: tmp }).json).includes('a-pack'))

// 5. 幂等：再停用两次都成
const off2 = prof.setEnabled('a-pack', false, { profile: tmp })
const off3 = prof.setEnabled('a-pack', false, { profile: tmp })
ok('重复停用不报错', off2.ok && off3.ok)

rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} 项过，${fail} 项没过`)
process.exit(fail === 0 ? 0 : 1)

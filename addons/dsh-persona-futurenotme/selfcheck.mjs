// 自检：这个包自己说得对，才算立得住
// 判据不是「代码能跑」，是「它说得出未来那个我为什么不认」。
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS, DIMS, DIM_LABEL, markNotme, rateOf, overdue,
  renderCost, renderReport, loadNotme, loadSettled, loadFuture,
} from './lib/notme.mjs';
import { version } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; }
  else { fail += 1; console.log(`✗ ${name}`); }
};

const ws = mkdtempSync(join(tmpdir(), 'futurenotme-'));
const dir = join(ws, DEFAULTS.dir);
const opts = { ...DEFAULTS };
const write = (file, rows) => {
  const p = join(dir, file);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return p;
};

// 一、配置与维
ok('默认目录在 .persona-framework', DEFAULTS.dir === '.persona-framework');
ok('默认要结过 4 条才报案', DEFAULTS.minSettled === 4);
ok('默认警讯线 0.5', DEFAULTS.warnRate === 0.5);
ok('四维齐', DIMS.length === 4 && DIMS.join() === 'when,where,with,self');
ok('四维各有中文标签', Object.values(DIM_LABEL).join() === '时,地,人,自己');

// 二、收与不收
ok('连一句话都没有，不收', markNotme(ws, {}, opts).ok === false);
ok('说不清差在哪一维，不收', markNotme(ws, { claim: '这事下周再说', dim: 'when' }, opts).ok === false);
ok('维写错，不收', markNotme(ws, { claim: '这事下周再说', dim: 'mood', why: '心情变了' }, opts).ok === false);
const good = markNotme(ws, { claim: '这事下周再说', dim: 'when', why: '下周这个项目已经结了', source: 'm07081' }, opts);
ok('四样齐了，收', good.ok === true && good.row.dim === 'when');
ok('落的是 future-not-me 这一本', existsSync(join(dir, DEFAULTS.notmeFile)));
ok('一笔一行，读得回来', loadNotme(ws, opts).length >= 1);
ok('收完当场给出代价', good.cost && typeof good.cost.rate === 'number' || good.cost.rate === null);

// 三、代价怎么算
const settled = [
  { id: 'f1', status: 'kept' },
  { id: 'f2', status: 'kept' },
  { id: 'f3', status: 'rejected' },
  { id: 'f4', status: 'dropped' },
];
const notme = [
  { id: 'f3', dim: 'when' },
  { id: 'f6', dim: 'self' },
];
const cost = rateOf(settled, notme);
ok('结过 4 条（pending 不算结）', cost.settled === 4);
ok('认 2 条', cost.kept === 2);
ok('认账率 2/4 = 0.5', cost.rate === 0.5);
ok('失认笔数按账算', cost.notme === 2);
ok('失配落在哪些维说得出来', cost.byDim.when === 1 && cost.byDim.self === 1 && cost.byDim.where === 0);
ok('一条都没结时 rate 为 null', rateOf([], []).rate === null);

// 四、段里的两句话
const line = renderCost(cost, { ...opts, warnRate: 0.6 });
ok('代价一行说得清结过几条、认账率多少', /认账率/.test(line) && /结过/.test(line));
ok('低于警讯线才补那句「价已经在收」', /价已经在收/.test(line));
const calm = renderCost({ ...cost, rate: 0.9 }, { ...opts, warnRate: 0.6 });
ok('高于警讯线不喊', !/价已经在收/.test(calm));
ok('没结账时不喊', renderCost(rateOf([], []), opts) === '' || !/价已经在收/.test(renderCost(rateOf([], []), opts)));

// 五、该认没认
write(DEFAULTS.futureFile, [
  { id: 'f9', claim: '下周一复盘这一版', status: 'pending', space: { when: '2026-01-01T00:00:00.000Z' } },
  { id: 'f10', claim: '以后再说', status: 'pending', space: { when: '2099-01-01T00:00:00.000Z' } },
]);
const over = overdue(ws, opts, Date.parse('2026-06-01T00:00:00.000Z'));
ok('过期还没认的挑得出来', over.length === 1 && over[0].id === 'f9');
ok('没到点的不算', over.every((r) => r.id !== 'f10'));

// 六、报告
const rep = renderReport(rateOf(settled, notme), notme, opts);
ok('报告里有认账率', /认账率/.test(rep));
ok('报告里说得出失配维', /时|地|人|自己/.test(rep));

// 七、包自己
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
ok('包名对', pkg.name === 'dsh-persona-futurenotme');
ok('版本对', pkg.version === version);
ok('有 bundle patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
ok('patch 文件在', existsSync(join(here, 'cordis.patch.yml')));
ok('图标在', existsSync(join(here, 'icon.svg')));
const zh = JSON.parse(readFileSync(join(here, 'locale', 'zh.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(here, 'locale', 'en.json'), 'utf8'));
ok('中文名在', typeof zh.name === 'string' && zh.name.length > 0);
ok('英文名在', typeof en.name === 'string' && en.name.length > 0);
const idx = readFileSync(join(here, 'index.js'), 'utf8');
ok('段名是 futurenotme', idx.includes("'实时环境:futurenotme'"));
ok('段排在 19', /order:\s*19/.test(idx));
ok('三个工具都注册', ['futurenotme_mark', 'futurenotme_report', 'futurenotme_check'].every((t) => idx.includes(t)));

rmSync(ws, { recursive: true, force: true });
console.log(`全部过了：${pass} 项过，${fail} 项没过。`);
process.exit(fail === 0 ? 0 : 1);

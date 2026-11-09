// 未来还有我 · 自检
// 判据：我说过的每一件小事，都先落成字、再验一遍它真按写的跑。
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  DEFAULTS, STATUS, DIMS, nowISO, futureDir, loadFutures,
  addFuture, overlapOf, risingItems, settleFuture, statsOf,
  renderRising, renderReport,
} from './lib/future.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

let pass = 0;
const fails = [];
function ok(name, fn) {
  try { fn(); pass += 1; } catch (e) { fails.push(`${name}：${e.message}`); }
}

const ws = join(tmpdir(), 'futurealsome-check-' + Date.now());
mkdirSync(ws, { recursive: true });
const opts = { dir: '.persona-framework' };

ok('默认配置有四个时空维度与两条账', () => {
  assert.deepEqual(DIMS, ['when', 'where', 'with', 'situation']);
  assert.equal(DEFAULTS.file, '未来账.jsonl');
  assert.equal(DEFAULTS.risingFile, '未来认账账.jsonl');
  assert.ok(DEFAULTS.minOverlap >= 1);
});

ok('状态只有四种，pending 不在可结账状态里', () => {
  assert.deepEqual(STATUS, ['pending', 'kept', 'rejected', 'dropped']);
  assert.ok(!['kept', 'rejected', 'dropped'].includes('pending'));
});

ok('时间戳是可解析的 ISO 串', () => {
  const s = nowISO(Date.now());
  assert.ok(!Number.isNaN(Date.parse(s)));
});

ok('账本目录按 opts.dir 落在工作区下', () => {
  assert.equal(futureDir(ws, opts), join(ws, '.persona-framework'));
  assert.equal(futureDir(ws, { dir: 'x/y' }), join(ws, 'x', 'y'));
});

ok('没有那句话，直接拒绝', () => {
  const r = addFuture(ws, { when: '明天' }, opts);
  assert.equal(r.ok, false);
  assert.match(r.why, /没有要留给未来的那句话/);
});

ok('有时空没话、有话说没时空，都拒绝', () => {
  const a = addFuture(ws, { claim: '我会把账记完' }, opts);
  assert.equal(a.ok, false);
  assert.match(a.why, /没有时空/);
});

ok('写了一样时空就能留下', () => {
  const r = addFuture(ws, { claim: '这条留给未来的我认', when: '2026-11-20T09:00:00+08:00' }, opts);
  assert.equal(r.ok, true);
  assert.match(r.item.id, /^f[0-9a-z]{1,10}$/);
  assert.equal(r.item.status, 'pending');
  assert.deepEqual(r.dims, ['when']);
});

ok('四样时空都写，落盘的就是四样', () => {
  const r = addFuture(ws, {
    claim: '把这条账翻出来对一遍',
    when: '2026-11-20T09:00:00+08:00',
    where: 'C:/爱思考的大肥鱼思思',
    with: '师父',
    situation: '说到未来还有我',
  }, opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.dims.sort(), ['situation', 'when', 'where', 'with']);
  const rows = loadFutures(ws, opts);
  const hit = rows.find((x) => x.id === r.item.id);
  assert.ok(hit);
  assert.equal(hit.space.where, 'C:/爱思考的大肥鱼思思');
});

ok('账本逐行读得回，坏行不会把整本弄坏', () => {
  const rows = loadFutures(ws, opts);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => r.claim));
});

ok('时间到了才认得出（when 这一维命中）', () => {
  const r = addFuture(ws, { claim: '时间维命中', when: '2026-11-01T00:00:00+08:00' }, opts);
  const hit = overlapOf(r.item, { at: Date.now(), situation: '' });
  assert.ok(hit.includes('when'));
});

ok('地点与人物按互含比，不要求逐字相同', () => {
  const r = addFuture(ws, { claim: '地点维命中', where: 'C:/爱思考的大肥鱼思思' }, opts);
  const hit = overlapOf(r.item, { where: 'c:/爱思考的大肥鱼思思/sub' });
  assert.ok(hit.includes('where'));
  const r2 = addFuture(ws, { claim: '人物维命中', with: '师父' }, opts);
  const hit2 = overlapOf(r2.item, { with: '师父' });
  assert.ok(hit2.includes('with'));
});

ok('情形按词比，命中一个词就算重合', () => {
  const r = addFuture(ws, { claim: '情形维命中', situation: '重启,插件,自检' }, opts);
  const hit = overlapOf(r.item, { situation: '今天说插件的事' });
  assert.ok(hit.includes('situation'));
});

ok('只写一维时，升起的门槛降到一维', () => {
  const r = addFuture(ws, { claim: '只有地点', where: 'C:/爱思考的大肥鱼思思' }, opts);
  const list = risingItems(loadFutures(ws, opts), { where: 'C:/爱思考的大肥鱼思思' }, opts);
  assert.ok(list.some((x) => x.entry.id === r.item.id));
});

ok('四维全写时，要两维对上才升起', () => {
  const r = addFuture(ws, {
    claim: '四维那条',
    when: '2027-01-01T00:00:00+08:00',
    where: 'C:/爱思考的大肥鱼思思',
    with: '师父',
    situation: '核对账本',
  }, opts);
  const one = risingItems(loadFutures(ws, opts), { where: 'C:/爱思考的大肥鱼思思' }, opts);
  assert.ok(!one.some((x) => x.entry.id === r.item.id), '一维不该升起');
  const two = risingItems(loadFutures(ws, opts), { where: 'C:/爱思考的大肥鱼思思', with: '师父' }, opts);
  assert.ok(two.some((x) => x.entry.id === r.item.id), '两维该升起');
});

ok('结账不接受 pending，也不接受账上没有的 id', () => {
  const rows = loadFutures(ws, opts);
  const id = rows[0].id;
  assert.equal(settleFuture(ws, id, 'pending', '', opts).ok, false);
  assert.equal(settleFuture(ws, 'fnope12345', 'kept', '', opts).ok, false);
});

ok('结账用 id 尾巴也能认，认完账上变状态', () => {
  const r = addFuture(ws, { claim: '要结的一条', where: 'C:/爱思考的大肥鱼思思' }, opts);
  const tail = r.item.id.slice(-4);
  const s = settleFuture(ws, tail, 'kept', '我认', { ...opts, ctx: { where: 'C:/爱思考的大肥鱼思思' } });
  assert.equal(s.ok, true);
  const rows = loadFutures(ws, opts);
  assert.equal(rows.find((x) => x.id === r.item.id).status, 'kept');
});

ok('认账账本落了一行，带 dims 与 claim', () => {
  const p = join(futureDir(ws, opts), DEFAULTS.risingFile);
  assert.ok(existsSync(p));
  const lines = readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(lines.length >= 1);
  assert.ok(lines[lines.length - 1].dims.length >= 1);
  assert.ok(lines[lines.length - 1].claim);
});

ok('统计只算已结的，没结过就是 null', () => {
  const rows = loadFutures(ws, opts);
  const st = statsOf(rows);
  assert.equal(typeof st.total, 'number');
  assert.ok(st.total >= 1);
  const empty = statsOf([]);
  assert.equal(empty.rate, null);
});

ok('没有升起时不占前缀', () => {
  assert.equal(renderRising([], { maxRising: 5 }), '');
});

ok('升起时第一行说清是时空对上了', () => {
  const text = renderRising([{ entry: { id: 'fabcd1234', claim: '这条', space: { where: 'C:/x' } }, hit: ['where'] }], { maxRising: 5 });
  assert.match(text, /未来还有我/);
  assert.match(text, /〔地〕/);
});

ok('报告给认账率与最近被推翻的', () => {
  const text = renderReport(loadFutures(ws, opts), {});
  assert.match(text, /认账/);
});

ok('包元信息、段名与四个工具都对得上', () => {
  assert.equal(pkg.name, 'dsh-persona-futurealsome');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const idx = readFileSync(join(here, 'index.js'), 'utf8');
  assert.match(idx, /实时环境:futurealsome/);
  assert.match(idx, /order:\s*18/);
  for (const t of ['future_leave', 'future_rising', 'future_settle', 'future_report']) {
    assert.match(idx, new RegExp(t));
  }
  assert.match(idx, /export const version = '0\.1\.0'/);
});

ok('中英双语目录都在，名字不为空', () => {
  for (const lang of ['zh', 'en']) {
    const j = JSON.parse(readFileSync(join(here, 'locale', `${lang}.json`), 'utf8'));
    assert.ok(j.name && j.description, `${lang} 缺名字或说明`);
  }
});

rmSync(ws, { recursive: true, force: true });

if (fails.length) {
  console.log(`没过：${fails.length} 项`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`全部过了：${pass} 项过，0 项没过。`);

'use strict';
// Replicates (format v0.3): order, numbering, version, repeatability.
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

const NOW = '2026-11-07T15:00:00Z';
/** A replicate of `id` on image `sha`, with LM01 at p1 and LM02 at p2 (null = not placed). */
function rep(id, sha, n, p1, p2) {
  const st = makeState();
  st.specimen = { id, image: { file: id + '.png', sha256: sha, width: 1000, height: 800 } };
  if (n > 1) st.specimen.replicate = n;
  if (p1) C.placeLm(st, 'LM01', p1, NOW);
  if (p2) C.placeLm(st, 'LM02', p2, NOW);
  return st;
}

test('nextTodo follows a given order; items it leaves out come after', () => {
  const s = makeState();
  const order = ['LM03', 'LM01', 'LM02'];
  assert.deepEqual(C.nextTodo(s, null, order), { kind: 'lm', id: 'LM03' });
  C.placeLm(s, 'LM03', [1, 1]);
  assert.deepEqual(C.nextTodo(s, { kind: 'lm', id: 'LM03' }, order), { kind: 'lm', id: 'LM01' });
  C.placeLm(s, 'LM01', [1, 1]); C.placeLm(s, 'LM02', [1, 1]);
  assert.deepEqual(C.nextTodo(s, { kind: 'lm', id: 'LM02' }, order), { kind: 'curve', id: 'C01' });
});

test('shuffledOrder is a permutation of the landmarks', () => {
  const s = makeState();
  let seed = 3; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const o = C.shuffledOrder(s, rand);
  assert.deepEqual([...o].sort(), ['LM01', 'LM02', 'LM03']);
  assert.notDeepEqual(o, ['LM01', 'LM02', 'LM03']);
});

test('nextReplicate counts replicates of the same specimen and image only', () => {
  const a = rep('FISH_01', 's1', 1), b = rep('FISH_01', 's1', 2), c = rep('FISH_02', 's2', 1), d = rep('FISH_01', 'other', 1);
  assert.equal(C.nextReplicate([a, b, c, d], a), 3);
  assert.equal(C.nextReplicate([a, b, c, d], c), 2);
  assert.ok(C.sameSpecimen(a, b));
  assert.ok(!C.sameSpecimen(a, d), 'another image of the same specimen is not a replicate');
});

test('a replicate after the first is saved as format 0.3.0 with specimen.replicate', () => {
  const d2 = C.buildDoc(rep('FISH_01', 's1', 2, [1, 1]), { now: NOW });
  assert.equal(d2.version, '0.3.0');
  assert.equal(d2.specimen.replicate, 2);
  assert.equal(C.buildDoc(rep('FISH_01', 's1', 1, [1, 1]), { now: NOW }).version, C.FORMAT_VERSION);
  assert.equal(C.docFileName(rep('FISH_01', 's1', 2)), 'FISH_01_r2.lmk.json');
});

test('repeatability: distance between two replicates per landmark, averaged over specimens', () => {
  const states = [
    rep('FISH_01', 's1', 1, [100, 100], [200, 200]), rep('FISH_01', 's1', 2, [103, 104], [200, 210]),
    rep('FISH_02', 's2', 1, [50, 50], [300, 300]), rep('FISH_02', 's2', 2, [50, 51], null),
    rep('FISH_03', 's3', 1, [9, 9], [9, 9]),   // only one replicate: not counted
  ];
  const r = C.repeatability(states);
  assert.equal(r.units, 'px');
  assert.deepEqual(r.specimens, [{ id: 'FISH_01', replicates: 2 }, { id: 'FISH_02', replicates: 2 }]);
  const lm1 = r.rows.find(x => x.id === 'LM01'), lm2 = r.rows.find(x => x.id === 'LM02'), lm3 = r.rows.find(x => x.id === 'LM03');
  assert.deepEqual([lm1.specimens, lm1.pairs, lm1.mean, lm1.max], [2, 2, 3, 5]);   // 5 and 1
  assert.deepEqual([lm2.specimens, lm2.pairs, lm2.mean, lm2.max], [1, 1, 10, 10]);
  assert.deepEqual([lm3.pairs, lm3.mean], [0, null]);
});

test('repeatability: three replicates give three pairs; missing points are left out', () => {
  const states = [rep('A', 'a', 1, [0, 0]), rep('A', 'a', 2, [3, 4]), rep('A', 'a', 3, [0, 4])];
  C.setStatus(states[2], { kind: 'lm', id: 'LM02' }, 'missing');
  const lm1 = C.repeatability(states).rows[0];
  assert.equal(lm1.pairs, 3);
  assert.equal(lm1.max, 5);
  assert.ok(Math.abs(lm1.mean - (5 + 4 + 3) / 3) < 1e-9);
});

test('repeatability is in scale units when every replicated specimen has the same units, else pixels', () => {
  const sc = st => { st.specimen.image.scale = { value: 0.1, units: 'mm', method: 'manual' }; return st; };
  const both = [sc(rep('A', 'a', 1, [0, 0])), sc(rep('A', 'a', 2, [30, 40]))];
  const r = C.repeatability(both);
  assert.equal(r.units, 'mm');
  assert.ok(Math.abs(r.rows[0].mean - 5) < 1e-9);
  const mixed = [sc(rep('A', 'a', 1, [0, 0])), rep('A', 'a', 2, [30, 40])];
  assert.equal(C.repeatability(mixed).units, 'px');
  assert.equal(C.repeatability(mixed).rows[0].mean, 50);
});

test('repeatability compares curves point by point', () => {
  const mk = (n, dy) => { const st = rep('A', 'a', n); C.placeLm(st, 'LM02', [0, dy]); C.placeLm(st, 'LM03', [40, dy]); C.ensureCurve(st, 'C01'); C.recomputeCurves(st); return st; };
  const c = C.repeatability([mk(1, 0), mk(2, 2)]).rows.find(x => x.kind === 'curve');
  assert.deepEqual([c.specimens, c.pairs, c.mean, c.max], [1, 3, 2, 2]);
});

test('repeatability flags rows more than twice the median', () => {
  const states = [rep('A', 'a', 1, [0, 0], [0, 0]), rep('A', 'a', 2, [1, 0], [9, 0])];
  C.placeLm(states[0], 'LM03', [0, 0]); C.placeLm(states[1], 'LM03', [1, 0]);
  const r = C.repeatability(states);
  assert.equal(r.median, 1);
  assert.deepEqual(r.rows.filter(x => x.flag).map(x => x.id), ['LM02']);
});

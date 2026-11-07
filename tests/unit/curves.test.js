'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState, close, assertPointClose } = require('./helpers.js');

test('resample: unanchored open line puts points on both ends', () => {
  const { L, pts } = C.resample([[0, 0], [40, 0]], 3, 0, 0, false);
  assert.equal(L, 40);
  [[0, 0], [20, 0], [40, 0]].forEach((q, i) => assertPointClose(assert, pts[i], q));
});

test('resample: both ends anchored excludes the end points', () => {
  const { pts } = C.resample([[0, 0], [40, 0]], 3, 1, 1, false);
  [[10, 0], [20, 0], [30, 0]].forEach((q, i) => assertPointClose(assert, pts[i], q));
});

test('resample: only the start anchored', () => {
  const { pts } = C.resample([[0, 0], [30, 0]], 3, 1, 0, false);
  [[10, 0], [20, 0], [30, 0]].forEach((q, i) => assertPointClose(assert, pts[i], q));
});

test('resample: equal arc length across a bend', () => {
  // L-shaped path, total length 20; 5 points unanchored -> every 5 units
  const { pts } = C.resample([[0, 0], [10, 0], [10, 10]], 5, 0, 0, false);
  [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]].forEach((q, i) => assertPointClose(assert, pts[i], q));
});

test('resample: closed loop spaces n points around the perimeter', () => {
  const sq = C.densePath([[0, 0], [10, 0], [10, 10], [0, 10]], 'polyline', true);
  assert.equal(sq.length, 5, 'closed polyline repeats the first point');
  const { L, pts } = C.resample(sq, 4, 0, 0, true);
  assert.equal(L, 40);
  [[0, 0], [10, 0], [10, 10], [0, 10]].forEach((q, i) => assertPointClose(assert, pts[i], q));
});

test('resample: a single unanchored point sits at the middle', () => {
  const { pts } = C.resample([[0, 0], [10, 0]], 1, 0, 0, false);
  assertPointClose(assert, pts[0], [5, 0]);
});

test('resample: zero-length path gives no points', () => {
  assert.deepEqual(C.resample([[3, 3], [3, 3]], 4, 0, 0, false).pts, []);
});

test('densePath: spline passes through every control point', () => {
  const P = [[0, 0], [50, 40], [120, 30], [200, 90]];
  const D = C.densePath(P, 'spline', false, 24);
  for (const p of P) assert.ok(D.some(q => close(q[0], p[0], 1e-9) && close(q[1], p[1], 1e-9)), `missing ${p}`);
  assert.equal(D.length, 3 * 24 + 1);
});

test('densePath: spline on collinear points stays on the line', () => {
  const D = C.densePath([[0, 0], [10, 0], [30, 0], [35, 0]], 'spline', false);
  for (const q of D) assert.ok(Math.abs(q[1]) < 1e-9);
});

test('densePath: two points fall back to a straight segment', () => {
  assert.deepEqual(C.densePath([[0, 0], [5, 5]], 'spline', false), [[0, 0], [5, 5]]);
});

test('densePath: spline tolerates duplicated control points', () => {
  const D = C.densePath([[0, 0], [0, 0], [10, 10], [20, 0]], 'spline', false);
  for (const q of D) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]));
});

test('spline resampling gives equal spacing along the dense path', () => {
  const D = C.densePath([[0, 0], [100, 80], [220, 40], [300, 120]], 'spline', false, 64);
  const { L, pts } = C.resample(D, 9, 1, 1, false);
  // arc length of each resampled point along D
  const cum = [0]; for (let i = 1; i < D.length; i++) cum.push(cum[i - 1] + C.dist(D[i - 1], D[i]));
  const arcOf = p => { let best = 0, bd = Infinity;
    for (let i = 1; i < D.length; i++) { const a = D[i - 1], b = D[i], ab = C.dist(a, b) || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (ab * ab)));
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = C.dist(p, q);
      if (d < bd) { bd = d; best = cum[i - 1] + ab * t; } }
    return best; };
  pts.forEach((p, k) => assert.ok(close(arcOf(p), (k + 1) * L / 10, 1e-6), `point ${k}`));
});

test('curveGeom: anchors come from the start and end landmarks', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  const c = C.ensureCurve(s, 'C01');
  c.control_points.push({ position: [300, 100] });
  const g = C.curveGeom(s, c, C.tCurve(s, 'C01'));
  assert.equal(g.err, null);
  assert.equal(g.a, 1); assert.equal(g.b, 1);
  assert.equal(g.L, 400);
  [[200, 100], [300, 100], [400, 100]].forEach((q, i) => assertPointClose(assert, g.pts[i], q));
});

test('curveGeom: reports an error when an anchor landmark is not placed', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  const c = C.ensureCurve(s, 'C01');
  c.control_points.push({ position: [300, 100] });
  const g = C.curveGeom(s, c, C.tCurve(s, 'C01'));
  assert.match(g.err, /LM03/);
  assert.deepEqual(g.pts, []);
});

test('curveGeom: a missing anchor landmark counts as not placed', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.setStatus(s, { kind: 'lm', id: 'LM03' }, 'missing');
  const c = C.ensureCurve(s, 'C01');
  const g = C.curveGeom(s, c, C.tCurve(s, 'C01'));
  assert.match(g.err, /LM03/);
});

test('curveGeom: closed curves ignore start and end', () => {
  const s = makeState();
  s.template.curves = [{ id: 'C02', name: 'Loop', start: 'LM01', closed: true, n_points: 4, path: 'polyline' }];
  const c = C.ensureCurve(s, 'C02');
  [[0, 0], [10, 0], [10, 10], [0, 10]].forEach(p => c.control_points.push({ position: p }));
  const g = C.curveGeom(s, c, C.tCurve(s, 'C02'));
  assert.equal(g.err, null);
  assert.equal(g.a, 0);
  assert.equal(g.pts.length, 4);
});

test('recomputeCurves fills points, length and sampling', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.ensureCurve(s, 'C01');
  C.recomputeCurves(s);
  const c = C.curveEntry(s, 'C01');
  assert.equal(c.points.length, 3);
  assert.equal(c.length, 400);
  assert.deepEqual(c.sampling, { path: 'polyline', spacing: 'equal_arc_length', n_points: 3 });
  assert.deepEqual(c.points[0], { position: [200, 100] });
});

test('recomputeCurves leaves a missing curve without points', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.setStatus(s, { kind: 'curve', id: 'C01' }, 'missing');
  C.recomputeCurves(s);
  assert.deepEqual(C.curveEntry(s, 'C01').points, []);
});

test('recomputeCurves follows a moved anchor landmark', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.ensureCurve(s, 'C01');
  C.recomputeCurves(s);
  C.placeLm(s, 'LM03', [900, 100]);
  C.recomputeCurves(s);
  assert.equal(C.curveEntry(s, 'C01').length, 800);
  assert.deepEqual(C.curveEntry(s, 'C01').points[1].position, [500, 100]);
});

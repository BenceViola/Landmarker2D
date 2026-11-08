'use strict';
// The rules of the spec's Curves section (v0.2), one test each.
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState, assertPointClose } = require('./helpers.js');

const cp = ps => ps.map(p => ({ position: p }));
const curveState = s => C.itemState(s, { kind: 'curve', id: 'C01' });
function withCurve(def, clicks, lms = {}) {
  const s = makeState();
  s.template.curves = [Object.assign({ id: 'C01', name: 'Edge' }, def)];
  for (const [id, p] of Object.entries(lms)) C.placeLm(s, id, p);
  C.ensureCurve(s, 'C01').control_points = cp(clicks);
  C.recomputeCurves(s);
  return s;
}
const pts = s => s.curves[0].points.map(p => p.position);

test('both ends anchored: the points lie strictly between the two landmarks', () => {
  const s = withCurve({ start: 'LM02', end: 'LM03', n_points: 3 }, [[20, 0]], { LM02: [0, 0], LM03: [40, 0] });
  pts(s).forEach((p, i) => assertPointClose(assert, p, [10 * (i + 1), 0]));
  assert.equal(s.curves[0].length, 40);
});

test('free ends: the first and last points are the ends of the path', () => {
  const s = withCurve({ n_points: 3 }, [[0, 0], [40, 0]]);
  pts(s).forEach((p, i) => assertPointClose(assert, p, [20 * i, 0]));
});

test('one free end gets a semilandmark of its own at the end', () => {
  const s = withCurve({ start: 'LM02', n_points: 2 }, [[40, 0]], { LM02: [0, 0] });
  assertPointClose(assert, pts(s)[0], [20, 0]);
  assertPointClose(assert, pts(s)[1], [40, 0]);
});

test('with one point it sits in the middle of the path, whichever ends are anchored', () => {
  for (const def of [{}, { start: 'LM02' }, { end: 'LM02' }, { start: 'LM02', end: 'LM03' }]) {
    const clicks = def.end && !def.start ? [[0, 0]] : def.start && def.end ? [[20, 0]] : def.start ? [[40, 0]] : [[0, 0], [40, 0]];
    const lms = def.start && def.end ? { LM02: [0, 0], LM03: [40, 0] } : def.start ? { LM02: [0, 0] } : def.end ? { LM02: [40, 0] } : {};
    const s = withCurve(Object.assign({ n_points: 1 }, def), clicks, lms);
    assert.equal(pts(s).length, 1, JSON.stringify(def));
    assertPointClose(assert, pts(s)[0], [20, 0], 1e-6, JSON.stringify(def));
  }
});

test('a closed loop needs at least three points and starts at the first click', () => {
  const s = withCurve({ closed: true, n_points: 4 }, [[0, 0], [40, 0]]);
  assert.deepEqual(pts(s), []);
  assert.equal(curveState(s), 'partial');
  const s3 = withCurve({ closed: true, n_points: 4 }, [[10, 0], [40, 0], [40, 30]]);
  assert.equal(pts(s3).length, 4);
  assertPointClose(assert, pts(s3)[0], [10, 0]);
  assert.equal(curveState(s3), 'placed');
});

test('an open curve needs at least two points, counting anchored ends', () => {
  assert.deepEqual(pts(withCurve({ n_points: 3 }, [[0, 0]])), []);
  assert.equal(pts(withCurve({ start: 'LM02', n_points: 3 }, [[40, 0]], { LM02: [0, 0] })).length, 3);
});

test('an anchored landmark that is missing or not placed: no semilandmarks yet', () => {
  const s = withCurve({ start: 'LM02', end: 'LM03', n_points: 3 }, [[20, 0]], { LM02: [0, 0] });
  assert.deepEqual(pts(s), []);
  C.setStatus(s, { kind: 'lm', id: 'LM03' }, 'missing');
  C.recomputeCurves(s);
  assert.deepEqual(pts(s), []);
  assert.equal(curveState(s), 'partial');
});

test('n_points that is not a positive whole number counts as the default 10', () => {
  for (const n of [0, -2, '5', 2.5, null, undefined]) {
    const s = withCurve({ n_points: n }, [[0, 0], [40, 0]]);
    assert.equal(pts(s).length, C.DEFAULT_CURVE_POINTS, String(n));
    assert.equal(s.curves[0].sampling.n_points, 10);
    assert.equal(C.exportRows(s).filter(r => r.type === 'curve').length, 10);
  }
});

test('changing n_points re-samples from the clicked points', () => {
  const s = withCurve({ n_points: 3 }, [[0, 0], [40, 0]]);
  s.template.curves[0].n_points = 5;
  C.recomputeCurves(s);
  assert.equal(pts(s).length, 5);
  assert.deepEqual(s.curves[0].sampling, { path: 'polyline', spacing: 'equal_arc_length', n_points: 5 });
});

test('points that don\'t match n_points: not done, in the app and in exports', () => {
  const s = withCurve({ n_points: 3 }, [[0, 0], [40, 0]]);
  s.curves[0].points.pop();   // e.g. a file saved before n_points changed
  assert.equal(curveState(s), 'partial');
  assert.equal(C.isDone(s, { kind: 'curve', id: 'C01' }), false);
  assert.deepEqual(C.exportRows(s).filter(r => r.type === 'curve').map(r => r.status), ['not_done', 'not_done', 'not_done']);
});

test('export rows: <curve id>_<nn>, type curve, missing curves as n_points missing rows', () => {
  const s = withCurve({ n_points: 2 }, [[0, 0], [40, 0]]);
  const rows = C.exportRows(s).filter(r => r.type === 'curve');
  assert.deepEqual(rows.map(r => [r.point, r.curve, r.index]), [['C01_01', 'C01', 1], ['C01_02', 'C01', 2]]);
  C.setStatus(s, { kind: 'curve', id: 'C01' }, 'missing');
  const csv = C.toCSV([s]).split('\n').filter(l => l.includes('C01_'));
  assert.equal(csv.length, 2);
  assert.ok(csv.every(l => /,NA,NA,px,missing$/.test(l)));
  assert.match(C.toTPS([s]), /^LM=5\n(-999 -999\n){5}/);
});

test('rows follow export_order when it lists curve ids', () => {
  const s = makeState();
  s.template.export_order = ['C01', 'LM03', 'LM02', 'LM01'];
  assert.deepEqual(C.exportRows(s).map(r => r.point), ['C01_01', 'C01_02', 'C01_03', 'LM03', 'LM02', 'LM01']);
});

test('a curve whose template_id is not in the template is kept unchanged on save', () => {
  const s = makeState();
  const d = C.buildDoc(s);
  d.curves = [{ id: 'C09', template_id: 'C09', status: 'placed', control_points: cp([[1, 2], [3, 4]]), points: cp([[2, 3]]), length: 2.8, extra: 1 }];
  const st = C.parseDoc(JSON.parse(JSON.stringify(d)), 'f');
  C.recomputeCurves(st);
  assert.deepEqual(C.buildDoc(st).curves, d.curves);
  assert.equal(C.exportRows(st).some(r => r.curve === 'C09'), false);
});

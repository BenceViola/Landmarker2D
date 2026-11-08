'use strict';
// Planes (format v0.4): this app keeps template.planes and their ids, but doesn't use them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

const NOW = '2026-11-08T12:00:00Z';
function withPlane() {
  const s = makeState();
  s.template.planes = [{ id: 'PL01', name: 'Midline', landmarks: ['LM01', 'LM02', 'LM03'], description: 'Best fit.' }];
  C.placeLm(s, 'LM01', [10, 20], NOW);
  return s;
}

test('a template with planes is saved as format 0.4.0, planes unchanged', () => {
  const s = withPlane();
  const d = C.buildDoc(s, { now: NOW });
  assert.equal(d.version, '0.4.0');
  assert.deepEqual(d.template.planes, s.template.planes);
  const back = C.parseDoc(JSON.parse(JSON.stringify(d)), 'f');
  assert.deepEqual(back.template.planes, s.template.planes);
  assert.equal(C.buildDoc(back, { now: NOW }).version, '0.4.0');
});

test('without planes the version stays 0.2.0; planes add no export rows', () => {
  const s = makeState();
  assert.equal(C.buildDoc(s, { now: NOW }).version, '0.2.0');
  const p = withPlane();
  assert.equal(C.exportRows(p).length, C.exportRows(makeState()).length);
  assert.ok(!C.toCSV([p]).includes('PL01'));
});

test('plane ids are taken: no new landmark, curve or rename can use them', () => {
  const s = withPlane();
  s.template.planes[0].id = 'LM04';
  C.addDefs(s, ['Fourth']);
  assert.equal(s.template.landmarks[3].id, 'LM05');
  assert.match(C.updateDef(s, 'LM01', { id: 'LM04' }), /already used/);
});

test('renaming or removing a landmark updates the planes that use it', () => {
  const s = withPlane();
  assert.equal(C.updateDef(s, 'LM03', { id: 'GO' }), null);   // LM03 has no data yet
  assert.deepEqual(s.template.planes[0].landmarks, ['LM01', 'LM02', 'GO']);
  C.removeDef(s, 'LM02');
  assert.deepEqual(s.template.planes[0].landmarks, ['LM01', 'GO']);
  assert.equal(s.template.planes.length, 1);   // kept, as in the 3D app
});

test('editing the template as text keeps planes, minus landmarks the text removed', () => {
  const s = withPlane();
  const t = C.textToTpl('LM01 | First\nLM03 | Third', s.template);
  assert.deepEqual(t.planes, [{ id: 'PL01', name: 'Midline', landmarks: ['LM01', 'LM03'], description: 'Best fit.' }]);
  assert.throws(() => C.textToTpl('LM01 | First\nPL01 | Clash', s.template), /used by a plane/);
});

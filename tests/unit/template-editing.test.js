'use strict';
// The editing functions behind the Template tab.
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

test('addDefs numbers new landmarks after the highest LM id and skips blank names', () => {
  const s = makeState();
  assert.deepEqual(C.addDefs(s, ['Bregma', '  ', 'Lambda ']), ['LM04', 'LM05']);
  assert.deepEqual(s.template.landmarks.slice(3), [{ id: 'LM04', name: 'Bregma' }, { id: 'LM05', name: 'Lambda' }]);
});

test('addDefs does not reuse an id held by an ad hoc point or a curve', () => {
  const s = C.newState();
  s.landmarks.push({ id: 'LM01', template_id: null, status: 'placed', position: [1, 1] });
  assert.deepEqual(C.addDefs(s, ['A']), ['LM02']);
});

test('setTemplateField sets and clears fields and checks the template id', () => {
  const s = makeState();
  assert.equal(C.setTemplateField(s, 'name', '  Cranium, lateral '), null);
  assert.equal(s.template.name, 'Cranium, lateral');
  assert.equal(C.setTemplateField(s, 'version', ''), null);
  assert.equal('version' in s.template, false);
  assert.match(C.setTemplateField(s, 'id', 'has space'), /letters, digits/);
  assert.match(C.setTemplateField(s, 'id', ''), /needs an ID/);
  assert.equal(s.template.id, 'test-tpl');
  assert.throws(() => C.setTemplateField(s, 'landmarks', 'x'), /Unknown template field/);
});

test('updateDef renames and describes a landmark', () => {
  const s = makeState();
  assert.equal(C.updateDef(s, 'LM01', { name: 'Nasion', description: 'Midline, frontonasal suture' }), null);
  assert.deepEqual(C.tLm(s, 'LM01'), { id: 'LM01', name: 'Nasion', description: 'Midline, frontonasal suture' });
  C.updateDef(s, 'LM01', { description: '' });
  assert.equal('description' in C.tLm(s, 'LM01'), false);
  assert.match(C.updateDef(s, 'LM01', { name: ' ' }), /needs a name/);
});

test('changing a landmark id updates pairs, curve ends and export order', () => {
  const s = makeState();
  s.template.export_order = ['LM03', 'LM02', 'LM01', 'C01'];
  assert.equal(C.updateDef(s, 'LM02', { id: 'POR_L' }), null);
  assert.equal(C.tLm(s, 'LM03').bilateral_pair, 'POR_L');
  assert.equal(C.tCurve(s, 'C01').start, 'POR_L');
  assert.deepEqual(s.template.export_order, ['LM03', 'POR_L', 'LM01', 'C01']);
});

test('landmark ids are refused when taken, malformed, empty, or locked by data', () => {
  const s = makeState();
  assert.match(C.updateDef(s, 'LM01', { id: 'LM02' }), /already used/);
  assert.match(C.updateDef(s, 'LM01', { id: 'C01' }), /already used/);
  assert.match(C.updateDef(s, 'LM01', { id: 'LM 1' }), /letters, digits/);
  assert.match(C.updateDef(s, 'LM01', { id: '' }), /needs an ID/);
  C.placeLm(s, 'LM01', [1, 1]);
  assert.match(C.updateDef(s, 'LM01', { id: 'NAS' }), /already has data/);
  assert.equal(C.tLm(s, 'LM01').id, 'LM01');
});

test('removeDef removes the point, pairs and curve ends that used it', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [1, 1]);
  C.placeLm(s, 'LM03', [5, 5]);
  s.template.export_order = ['LM01', 'LM02', 'LM03', 'C01'];
  C.removeDef(s, 'LM02');
  assert.deepEqual(s.template.landmarks.map(d => d.id), ['LM01', 'LM03']);
  assert.equal(C.lmEntry(s, 'LM02'), undefined);
  assert.equal('bilateral_pair' in C.tLm(s, 'LM03'), false);
  assert.equal('start' in C.tCurve(s, 'C01'), false);
  assert.equal(C.tCurve(s, 'C01').end, 'LM03');
  assert.deepEqual(s.template.export_order, ['LM01', 'LM03', 'C01']);
});

test('moveItem reorders landmarks and curves, and the list order becomes the export order', () => {
  const s = makeState();
  s.template.export_order = ['LM03', 'LM01', 'LM02'];
  C.moveItem(s, 'lm', 'LM03', -1);
  assert.deepEqual(s.template.landmarks.map(d => d.id), ['LM01', 'LM03', 'LM02']);
  assert.equal('export_order' in s.template, false);
  C.moveItem(s, 'lm', 'LM01', -1); // already first: nothing happens
  assert.deepEqual(s.template.landmarks.map(d => d.id), ['LM01', 'LM03', 'LM02']);
  C.addCurve(s, 'Second');
  C.moveItem(s, 'curve', 'C02', -1);
  assert.deepEqual(s.template.curves.map(c => c.id), ['C02', 'C01']);
  assert.deepEqual(C.exportRows(s).map(r => r.point).slice(0, 3), ['LM01', 'LM03', 'LM02']);
});

test('setPair keeps bilateral pairs symmetric', () => {
  const s = makeState(); // LM02 <-> LM03
  C.setPair(s, 'LM01', 'LM02');
  assert.equal(C.tLm(s, 'LM01').bilateral_pair, 'LM02');
  assert.equal(C.tLm(s, 'LM02').bilateral_pair, 'LM01');
  assert.equal('bilateral_pair' in C.tLm(s, 'LM03'), false, 'old partner released');
  C.setPair(s, 'LM02', null);
  assert.equal('bilateral_pair' in C.tLm(s, 'LM01'), false);
  assert.equal('bilateral_pair' in C.tLm(s, 'LM02'), false);
  C.setPair(s, 'LM01', 'LM01');
  assert.equal('bilateral_pair' in C.tLm(s, 'LM01'), false, 'cannot pair with itself');
});

test('addCurve uses the next C id and sensible defaults', () => {
  const s = makeState();
  assert.equal(C.addCurve(s, '  '), null);
  assert.equal(C.addCurve(s, 'Lower edge'), 'C02');
  assert.deepEqual(C.tCurve(s, 'C02'), { id: 'C02', name: 'Lower edge', n_points: 10, path: 'polyline', spacing: 'equal_arc_length' });
});

test('updateCurve changes ends, points and path, and resampling follows', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [0, 0]);
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.ensureCurve(s, 'C01');
  C.recomputeCurves(s);
  assert.equal(C.curveEntry(s, 'C01').points.length, 3);
  assert.equal(C.updateCurve(s, 'C01', { start: 'LM01', n_points: 4, path: 'spline', description: 'Along the edge' }), null);
  C.recomputeCurves(s);
  const t = C.tCurve(s, 'C01');
  assert.equal(t.start, 'LM01');
  assert.equal(t.description, 'Along the edge');
  assert.equal(C.curveEntry(s, 'C01').points.length, 4);
  assert.equal(C.curveEntry(s, 'C01').sampling.path, 'spline');
  C.updateCurve(s, 'C01', { end: null });
  assert.equal('end' in C.tCurve(s, 'C01'), false);
});

test('a closed curve drops its start and end', () => {
  const s = makeState();
  assert.equal(C.updateCurve(s, 'C01', { closed: true }), null);
  const t = C.tCurve(s, 'C01');
  assert.equal(t.closed, true);
  assert.equal('start' in t || 'end' in t, false);
  C.updateCurve(s, 'C01', { closed: false });
  assert.equal('closed' in C.tCurve(s, 'C01'), false);
});

for (const [name, patch, re] of [
  ['zero points', { n_points: 0 }, /whole number from 1/],
  ['fractional points', { n_points: 2.5 }, /whole number/],
  ['too many points', { n_points: 10000 }, /whole number/],
  ['an unknown path', { path: 'bezier' }, /polyline/],
  ['an end that is not a landmark', { end: 'LM99' }, /LM99 is not a landmark/],
  ['the same start and end', { start: 'LM02', end: 'LM02' }, /same landmark/],
  ['an empty name', { name: '' }, /needs a name/],
  ['an id already used', { id: 'LM01' }, /already used/],
]) {
  test(`updateCurve refuses ${name} and changes nothing`, () => {
    const s = makeState();
    const before = JSON.stringify(s.template);
    assert.match(C.updateCurve(s, 'C01', patch), re);
    assert.equal(JSON.stringify(s.template), before);
  });
}

test('a curve id is locked once the curve has data', () => {
  const s = makeState();
  assert.equal(C.updateCurve(s, 'C01', { id: 'EDGE' }), null);
  C.ensureCurve(s, 'EDGE');
  assert.match(C.updateCurve(s, 'EDGE', { id: 'C09' }), /already has data/);
});

test('removeCurve removes the definition and its clicked points', () => {
  const s = makeState();
  C.ensureCurve(s, 'C01').control_points.push({ position: [1, 1] });
  C.removeCurve(s, 'C01');
  assert.deepEqual(s.template.curves, []);
  assert.deepEqual(s.curves, []);
});

test('newTemplate empties the template and all points', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [1, 1]);
  C.addAdhoc(s, [2, 2]);
  C.newTemplate(s);
  assert.deepEqual(s.template, C.emptyTemplate());
  assert.deepEqual(s.landmarks, []);
  assert.deepEqual(s.curves, []);
});

test('an edited template still passes the 2D template check and saves', () => {
  const s = C.newState();
  C.setTemplateField(s, 'name', 'Leaf');
  C.addDefs(s, ['Base', 'Apex']);
  const cid = C.addCurve(s, 'Margin');
  C.updateCurve(s, cid, { start: 'LM01', end: 'LM02', n_points: 6, path: 'spline' });
  assert.doesNotThrow(() => C.checkTemplate(s.template));
  const d = C.buildDoc(s, { now: '2026-11-07T00:00:00Z' });
  assert.equal(d.template.curves[0].n_points, 6);
  // and it survives the text format too
  assert.deepEqual(C.textToTpl(C.tplToText(s.template), {}).curves, s.template.curves);
});

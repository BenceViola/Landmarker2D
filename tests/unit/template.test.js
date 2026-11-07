'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

const TEXT = `# id: cranium-lateral
# name: Cranium, lateral
# version: 1.2

LM01 | Nasion | Most anterior point of the frontonasal suture
LM02 | Porion L | pair=LM03
LM03 | Porion R | pair=LM02

curve C01 | Brow ridge | start=LM01 end=LM02 n=8 path=spline
curve C02 | Orbit rim | n=12 path=polyline closed | Around the orbit`;

test('textToTpl parses landmarks, pairs, curves and header lines', () => {
  const t = C.textToTpl(TEXT, {});
  assert.equal(t.id, 'cranium-lateral');
  assert.equal(t.name, 'Cranium, lateral');
  assert.equal(t.version, '1.2');
  assert.equal(t.dimensions, 2);
  assert.deepEqual(t.landmarks[0], { id: 'LM01', name: 'Nasion', description: 'Most anterior point of the frontonasal suture' });
  assert.equal(t.landmarks[1].bilateral_pair, 'LM03');
  assert.deepEqual(t.curves[0], { id: 'C01', name: 'Brow ridge', n_points: 8, path: 'spline', spacing: 'equal_arc_length', start: 'LM01', end: 'LM02' });
  assert.equal(t.curves[1].closed, true);
  assert.equal(t.curves[1].description, 'Around the orbit');
});

test('tplToText and textToTpl round-trip', () => {
  const t1 = C.textToTpl(TEXT, {});
  const t2 = C.textToTpl(C.tplToText(t1), {});
  assert.deepEqual(t2, t1);
});

test('textToTpl keeps fields the text format does not show', () => {
  const base = { id: 'x', author: 'B. Viola', extra: { lab: true },
    landmarks: [{ id: 'LM01', name: 'Old', image: 'refs/lm01.jpg' }], curves: [{ id: 'C01', name: 'c', foo: 1 }] };
  const t = C.textToTpl('LM01 | New name\ncurve C01 | c | n=4', base);
  assert.equal(t.extra.lab, true);
  assert.equal(t.author, 'B. Viola');
  assert.equal(t.landmarks[0].image, 'refs/lm01.jpg');
  assert.equal(t.landmarks[0].name, 'New name');
  assert.equal(t.curves[0].foo, 1);
});

test('textToTpl drops export_order (list order becomes export order)', () => {
  const t = C.textToTpl('LM02 | b\nLM01 | a', { export_order: ['LM01', 'LM02'] });
  assert.equal(t.export_order, undefined);
  assert.deepEqual(t.landmarks.map(l => l.id), ['LM02', 'LM01']);
});

for (const [name, text, re] of [
  ['duplicate ids', 'LM01 | a\nLM01 | b', /used twice/],
  ['id with spaces', 'LM 01 | a', /spaces/],
  ['bad path', 'LM01 | a\ncurve C1 | c | path=bezier', /polyline or spline/],
  ['unknown curve option', 'curve C1 | c | wiggle=3', /unknown curve option/],
  ['n below 1', 'curve C1 | c | n=0', /n must be 1/],
  ['start not a landmark', 'LM01 | a\ncurve C1 | c | start=LM09', /LM09 is not a landmark/],
  ['pair not in template', 'LM01 | a | pair=LM02', /pair LM02/],
]) {
  test(`textToTpl rejects ${name}`, () => assert.throws(() => C.textToTpl(text, {}), re));
}

test('checkTemplate accepts 2D and refuses 3D, missing dimensions and references', () => {
  assert.doesNotThrow(() => C.checkTemplate({ dimensions: 2, landmarks: [] }));
  assert.throws(() => C.checkTemplate({ dimensions: 3, landmarks: [] }), /3D/);
  assert.throws(() => C.checkTemplate({ landmarks: [] }), /3D/, 'absent dimensions default to 3');
  assert.throws(() => C.checkTemplate({ ref: 'x.template.json', id: 'x' }), /references/);
  assert.throws(() => C.checkTemplate({ dimensions: 2 }), /no landmarks/);
  assert.throws(() => C.checkTemplate(null), /No template/);
});

test('applyTemplate turns removed landmarks into ad hoc points and drops removed curves', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [1, 1]);
  C.placeLm(s, 'LM02', [2, 2]);
  C.ensureCurve(s, 'C01');
  C.applyTemplate(s, C.textToTpl('LM02 | Second', {}));
  const lm1 = C.lmEntry(s, 'LM01');
  assert.equal(lm1.template_id, null);
  assert.equal(lm1.label, 'LM01');
  assert.deepEqual(C.adhocEntries(s).map(e => e.id), ['LM01']);
  assert.equal(C.lmEntry(s, 'LM02').template_id, 'LM02');
  assert.equal(s.curves.length, 0);
});

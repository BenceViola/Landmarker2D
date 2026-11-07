'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

const NOW = '2026-11-07T15:00:00Z';

/** The 2D example from the format specification, with the shortened template filled in. */
const SPEC_EXAMPLE = {
  format: 'landmark-json',
  version: '0.2.0',
  specimen: {
    id: 'SKULL_014',
    image: {
      file: 'SKULL_014_lateral.jpg', sha256: '51ab...07cd', width: 4000, height: 3000,
      scale: { value: 0.0125, units: 'mm', method: 'scale_bar', bar: { points: [[310.5, 2810.0], [1110.5, 2810.0]], length: 10 } },
    },
  },
  template: { id: 'cranium-lateral', version: '1.0', dimensions: 2, landmarks: [{ id: 'LM01', name: 'Nasion' }, { id: 'LM02', name: 'Porion' }] },
  landmarks: [
    { id: 'LM01', template_id: 'LM01', status: 'placed', position: [1834.25, 942.75] },
    { id: 'LM02', template_id: 'LM02', status: 'missing', position: null },
  ],
};

test('the specification example opens', () => {
  const st = C.parseDoc(SPEC_EXAMPLE, 'example');
  assert.equal(st.specimen.id, 'SKULL_014');
  assert.equal(st.landmarks.length, 2);
  assert.equal(C.itemState(st, { kind: 'lm', id: 'LM02' }), 'missing');
});

test('opening and saving keeps every field, known or not', () => {
  const doc = JSON.parse(JSON.stringify(SPEC_EXAMPLE));
  doc.extensions = { mylab: { batch: 7 } };
  doc.surfaces = [];
  doc.specimen.image.camera = 'Nikon D850';
  doc.landmarks[0].confidence = 0.9;
  doc.template.author = 'B. Viola';
  doc.provenance = { software: 'other-tool', created: '2026-01-01T00:00:00Z', operator: 'student07', lab_id: 'X1' };
  const st = C.parseDoc(doc, 'f');
  const out = C.buildDoc(st, { now: NOW });
  assert.deepEqual(out.extensions, { mylab: { batch: 7 } });
  assert.deepEqual(out.surfaces, []);
  assert.equal(out.specimen.image.camera, 'Nikon D850');
  assert.equal(out.landmarks[0].confidence, 0.9);
  assert.equal(out.template.author, 'B. Viola');
  assert.equal(out.provenance.lab_id, 'X1');
  assert.equal(out.provenance.created, '2026-01-01T00:00:00Z', 'created is kept');
  assert.equal(out.provenance.modified, NOW);
  assert.equal(out.provenance.software, C.SOFTWARE);
  assert.equal(out.provenance.operator, 'student07');
});

test('buildDoc writes a valid 2D document', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [10.5, 20.25], '2026-11-07T14:00:00Z');
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.ensureCurve(s, 'C01');
  C.recomputeCurves(s);
  const d = C.buildDoc(s, { now: NOW, operator: 'student01', notes: 'left side' });
  assert.equal(d.format, 'landmark-json');
  assert.equal(d.version, C.FORMAT_VERSION);
  assert.equal(d.specimen.id, 'SPEC_01');
  assert.equal(d.specimen.notes, 'left side');
  assert.equal(d.specimen.mesh, undefined);
  assert.equal(d.template.dimensions, 2);
  assert.deepEqual(d.landmarks[0], { id: 'LM01', template_id: 'LM01', status: 'placed', position: [10.5, 20.25], placed_at: '2026-11-07T14:00:00Z' });
  assert.equal(d.curves.length, 1);
  assert.equal(d.curves[0]._geom, undefined, 'private fields are not saved');
  assert.equal(d.curves[0].points.length, 3);
  assert.equal(d.provenance.operator, 'student01');
  assert.equal(d.provenance.created, NOW);
  for (const e of d.landmarks) assert.ok(C.STATUSES.includes(e.status));
});

test('buildDoc sorts landmarks in template order with ad hoc points last', () => {
  const s = makeState();
  C.addAdhoc(s, [1, 1]);
  C.placeLm(s, 'LM03', [3, 3]);
  C.placeLm(s, 'LM01', [1, 1]);
  assert.deepEqual(C.buildDoc(s, { now: NOW }).landmarks.map(e => e.id), ['LM01', 'LM03', 'AH01']);
});

test('buildDoc leaves out curves when there are none and the file had none', () => {
  assert.equal('curves' in C.buildDoc(makeState(), { now: NOW }), false);
});

test('buildDoc overrides the specimen id and removes empty notes', () => {
  const s = makeState();
  s.specimen.notes = 'old';
  const d = C.buildDoc(s, { now: NOW, specimenId: 'NEW_ID', notes: '' });
  assert.equal(d.specimen.id, 'NEW_ID');
  assert.equal(d.specimen.notes, undefined);
});

test('a saved document opens back into the same state', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'missing');
  C.ensureCurve(s, 'C01').control_points.push({ position: [300, 90] });
  C.recomputeCurves(s);
  s.specimen.image.scale = C.scaleFromBar([[0, 0], [400, 0]], 10, 'mm');
  const d1 = C.buildDoc(s, { now: NOW });
  const s2 = C.parseDoc(JSON.parse(JSON.stringify(d1)), 'roundtrip');
  C.recomputeCurves(s2);
  assert.deepEqual(C.buildDoc(s2, { now: NOW }), d1);
  assert.equal(C.toTPS(s2), C.toTPS(s));
});

for (const [name, mutate, re] of [
  ['other JSON', d => { d.format = 'something'; }, /not a landmark-json/],
  ['a newer major version', d => { d.version = '1.0.0'; }, /newer than this app/],
  ['3D mesh data', d => { delete d.specimen.image; d.specimen.mesh = { file: 'x.ply' }; }, /3D mesh/],
  ['no image', d => { delete d.specimen.image; }, /no image/],
  ['a 3D template', d => { d.template.dimensions = 3; }, /3D/],
]) {
  test(`parseDoc refuses ${name}`, () => {
    const d = JSON.parse(JSON.stringify(SPEC_EXAMPLE));
    mutate(d);
    assert.throws(() => C.parseDoc(d, 'f.lmk.json'), re);
  });
}

test('parseDoc accepts a newer minor version', () => {
  const d = JSON.parse(JSON.stringify(SPEC_EXAMPLE));
  d.version = '0.9.0';
  assert.doesNotThrow(() => C.parseDoc(d));
});

test('sniffJson tells documents from templates', () => {
  assert.equal(C.sniffJson(SPEC_EXAMPLE), 'doc');
  assert.equal(C.sniffJson(SPEC_EXAMPLE.template), 'template');
  assert.equal(C.sniffJson({ hello: 1 }), null);
});

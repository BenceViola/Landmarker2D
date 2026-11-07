'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

function filled() {
  const s = makeState();
  C.placeLm(s, 'LM01', [10.5, 20.5]);
  C.placeLm(s, 'LM02', [100, 100]);
  C.placeLm(s, 'LM03', [500, 100]);
  C.ensureCurve(s, 'C01');
  C.recomputeCurves(s);
  return s;
}

test('TPS flips y, lists curve points after landmarks and ends with IMAGE and ID', () => {
  const tps = C.toTPS(filled());
  assert.equal(tps, [
    'LM=6',
    '10.5 779.5',
    '100 700', '500 700',
    '200 700', '300 700', '400 700',
    'IMAGE=spec01.jpg',
    'ID=SPEC_01',
  ].join('\n') + '\n');
});

test('TPS adds SCALE when the image is calibrated', () => {
  const s = filled();
  s.specimen.image.scale = C.scaleFromBar([[0, 0], [400, 0]], 10, 'mm');
  assert.match(C.toTPS(s), /\nSCALE=0\.025\n$/);
});

test('TPS writes -999 -999 for missing and not-done points', () => {
  const s = makeState();
  C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'missing');
  const lines = C.toTPS(s).trim().split('\n');
  assert.equal(lines[0], 'LM=6');
  assert.deepEqual(lines.slice(1, 7), Array(6).fill('-999 -999'));
  const rows = C.exportRows(s);
  assert.equal(rows[0].status, 'missing');
  assert.equal(rows[1].status, 'not_done');
  assert.equal(C.notDoneCount(rows), 5);
});

test('TPS uses the given specimen id', () => {
  assert.match(C.toTPS(filled(), 'OVERRIDE'), /\nID=OVERRIDE\n/);
});

test('export_order sets the row order; unlisted items follow', () => {
  const s = filled();
  s.template.export_order = ['LM03', 'C01'];
  assert.deepEqual(C.exportRows(s).map(r => r.point), ['LM03', 'C01_01', 'C01_02', 'C01_03', 'LM01', 'LM02']);
});

test('ad hoc points come after the template points', () => {
  const s = filled();
  C.addAdhoc(s, [7, 7]);
  const rows = C.exportRows(s);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[6], { point: 'AH01', template_id: '', label: 'Ad hoc 1', type: 'adhoc', curve: '', index: '', pos: [7, 7], status: 'placed' });
});

test('an incomplete curve exports as n missing rows', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]);
  C.ensureCurve(s, 'C01');
  C.recomputeCurves(s);
  const rows = C.exportRows(s).filter(r => r.type === 'curve');
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.pos === null && r.status === 'not_done'));
});

test('CSV is in pixels without a scale, y down, NA for missing', () => {
  const s = filled();
  C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'missing');
  const lines = C.toCSV(s).trim().split('\n');
  assert.equal(lines[0], 'specimen_id,image,point,template_id,label,type,curve,index,x,y,units,status');
  assert.equal(lines[1], 'SPEC_01,spec01.jpg,LM01,LM01,First,landmark,,,NA,NA,px,missing');
  assert.equal(lines[2], 'SPEC_01,spec01.jpg,LM02,LM02,Second,landmark,,,100,100,px,placed');
  assert.equal(lines[4], 'SPEC_01,spec01.jpg,C01_01,C01,Edge,curve,C01,1,200,100,px,placed');
});

test('CSV is in scale units when calibrated', () => {
  const s = filled();
  s.specimen.image.scale = C.scaleFromBar([[0, 0], [400, 0]], 10, 'mm');
  const lines = C.toCSV(s).trim().split('\n');
  assert.equal(lines[2], 'SPEC_01,spec01.jpg,LM02,LM02,Second,landmark,,,2.5,2.5,mm,placed');
});

test('CSV keeps the estimated flag', () => {
  const s = filled();
  C.setStatus(s, { kind: 'lm', id: 'LM02' }, 'estimated');
  assert.match(C.toCSV(s), /LM02,LM02,Second,landmark,,,100,100,px,estimated/);
});

test('CSV quotes labels with commas and quotes', () => {
  const s = filled();
  s.template.landmarks[0].name = 'Widest point, "upper"';
  assert.match(C.toCSV(s), /LM01,LM01,"Widest point, ""upper""",landmark/);
});

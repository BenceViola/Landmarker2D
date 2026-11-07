'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { C, makeState } = require('./helpers.js');

test('items lists template landmarks, then curves', () => {
  assert.deepEqual(C.items(makeState()), [
    { kind: 'lm', id: 'LM01' }, { kind: 'lm', id: 'LM02' }, { kind: 'lm', id: 'LM03' }, { kind: 'curve', id: 'C01' },
  ]);
});

test('itemState covers to-do, placed, estimated, missing and partial curves', () => {
  const s = makeState();
  assert.equal(C.itemState(s, { kind: 'lm', id: 'LM01' }), 'todo');
  C.placeLm(s, 'LM01', [5, 5]);
  assert.equal(C.itemState(s, { kind: 'lm', id: 'LM01' }), 'placed');
  C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'estimated');
  assert.equal(C.itemState(s, { kind: 'lm', id: 'LM01' }), 'estimated');
  C.setStatus(s, { kind: 'lm', id: 'LM02' }, 'missing');
  assert.equal(C.itemState(s, { kind: 'lm', id: 'LM02' }), 'missing');
  const c = C.ensureCurve(s, 'C01');
  c.control_points.push({ position: [1, 1] });
  C.recomputeCurves(s);
  assert.equal(C.itemState(s, { kind: 'curve', id: 'C01' }), 'partial', 'anchors not placed yet');
});

test('placeLm keeps "estimated" when a point is moved', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [5, 5]);
  C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'estimated');
  C.placeLm(s, 'LM01', [6, 6], '2026-01-01T00:00:00Z');
  const e = C.lmEntry(s, 'LM01');
  assert.equal(e.status, 'estimated');
  assert.deepEqual(e.position, [6, 6]);
  assert.equal(e.placed_at, '2026-01-01T00:00:00Z');
});

test('placeLm rounds to 6 decimals', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [1.23456789, 2.000000449]);
  assert.deepEqual(C.lmEntry(s, 'LM01').position, [1.234568, 2]);
});

test('setStatus missing clears the position; placed without position asks for a click', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [5, 5]);
  C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'missing');
  assert.equal(C.lmEntry(s, 'LM01').position, null);
  assert.equal(C.setStatus(s, { kind: 'lm', id: 'LM02' }, 'placed'), 'needs_position');
  assert.equal(C.lmEntry(s, 'LM02'), undefined, 'no empty entry is left behind');
  assert.throws(() => C.setStatus(s, { kind: 'lm', id: 'LM01' }, 'done'), /Unknown status/);
});

test('nextTodo skips finished items and wraps around', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [1, 1]);
  C.setStatus(s, { kind: 'lm', id: 'LM02' }, 'missing');
  assert.deepEqual(C.nextTodo(s, null), { kind: 'lm', id: 'LM03' });
  assert.deepEqual(C.nextTodo(s, { kind: 'curve', id: 'C01' }), { kind: 'lm', id: 'LM03' }, 'wraps from the end');
  C.placeLm(s, 'LM03', [3, 3]);
  C.setStatus(s, { kind: 'curve', id: 'C01' }, 'missing');
  C.recomputeCurves(s);
  assert.equal(C.nextTodo(s, null), null);
});

test('ad hoc points get the next free AH id', () => {
  const s = makeState();
  const a = C.addAdhoc(s, [1, 1]);
  const b = C.addAdhoc(s, [2, 2]);
  assert.equal(a.id, 'AH01'); assert.equal(b.id, 'AH02');
  assert.equal(a.template_id, null);
  assert.equal(a.label, 'Ad hoc 1');
  C.clearItem(s, { kind: 'lm', id: 'AH01' });
  assert.equal(C.newAdhocId(s), 'AH01');
});

test('clearItem removes landmarks and curves', () => {
  const s = makeState();
  C.placeLm(s, 'LM01', [1, 1]);
  C.ensureCurve(s, 'C01');
  C.clearItem(s, { kind: 'lm', id: 'LM01' });
  C.clearItem(s, { kind: 'curve', id: 'C01' });
  assert.equal(s.landmarks.length, 0);
  assert.equal(s.curves.length, 0);
});

test('scaleFromBar computes units per pixel and validates input', () => {
  const sc = C.scaleFromBar([[100, 50], [500, 50]], 10, 'mm');
  assert.deepEqual(sc, { value: 0.025, units: 'mm', method: 'scale_bar', bar: { points: [[100, 50], [500, 50]], length: 10 } });
  assert.throws(() => C.scaleFromBar([[0, 0], [10, 0]], 0, 'mm'), /greater than zero/);
  assert.throws(() => C.scaleFromBar([[5, 5], [5, 5]], 1, 'mm'), /same place/);
  assert.throws(() => C.scaleFromBar([[0, 0], [1, 0]], 1, 'inch'), /Unknown units/);
});

test('sha256Hex matches the standard test vector', async () => {
  const hex = await C.sha256Hex(new TextEncoder().encode('abc'));
  assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('stem strips image and .lmk.json extensions', () => {
  assert.equal(C.stem('SKULL_014_lateral.jpg'), 'SKULL_014_lateral');
  assert.equal(C.stem('SKULL_014.lmk.json'), 'SKULL_014');
});

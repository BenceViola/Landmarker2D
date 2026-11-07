'use strict';
const C = require('../../src/core.js');

/** A small 2D specimen: 3 landmarks and one anchored curve, on a 1000 × 800 image. */
function makeState() {
  const s = C.newState();
  s.specimen = { id: 'SPEC_01', image: { file: 'spec01.jpg', sha256: 'abc123', width: 1000, height: 800 } };
  s.template = {
    id: 'test-tpl', name: 'Test template', version: '1.0', dimensions: 2,
    landmarks: [
      { id: 'LM01', name: 'First' },
      { id: 'LM02', name: 'Second', bilateral_pair: 'LM03' },
      { id: 'LM03', name: 'Third', bilateral_pair: 'LM02' },
    ],
    curves: [
      { id: 'C01', name: 'Edge', start: 'LM02', end: 'LM03', n_points: 3, path: 'polyline', spacing: 'equal_arc_length' },
    ],
  };
  return s;
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function assertPointClose(assert, p, q, eps = 1e-6, msg = '') {
  assert.ok(close(p[0], q[0], eps) && close(p[1], q[1], eps), `${msg} expected [${q}] got [${p}]`);
}

module.exports = { C, makeState, close, assertPointClose };

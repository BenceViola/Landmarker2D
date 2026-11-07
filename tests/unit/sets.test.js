'use strict';
// Specimen sets: several specimens sharing one template, combined exports, hand-in and combining.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { C, makeState } = require('./helpers.js');

const NOW = '2026-11-07T15:00:00Z';

/** A set of n specimens on the test template; specimen i has LM01 placed at (i, i). */
function makeSet(n) {
  const set = C.newSet(makeState().template);
  for (let i = 1; i <= n; i++) {
    const st = makeState();
    st.specimen = { id: `FISH_0${i}`, image: { file: `fish0${i}.png`, sha256: `sha${i}`, width: 100, height: 80 } };
    C.joinSet(set, st);
    C.placeLm(st, 'LM01', [i, i], NOW);
  }
  return set;
}
function finish(st) {
  C.placeLm(st, 'LM02', [10, 10]); C.placeLm(st, 'LM03', [50, 10]);
  C.ensureCurve(st, 'C01'); C.recomputeCurves(st);
}

test('specimens in a set share one template object', () => {
  const set = makeSet(2);
  const [a, b] = set.specimens;
  C.updateDef(a, 'LM02', { name: 'Renamed' });
  assert.equal(C.tLm(b, 'LM02').name, 'Renamed');
  assert.equal(a.template, b.template);
  C.addDefs(b, ['New']);
  assert.equal(a.template.landmarks.length, 4);
});

test('an ID is locked when any specimen in the set has data for it', () => {
  const set = makeSet(2);
  const [a, b] = set.specimens;
  C.placeLm(b, 'LM02', [5, 5]);
  assert.match(C.updateDef(a, 'LM02', { id: 'X' }), /already has data/);
  C.ensureCurve(b, 'C01');
  assert.match(C.updateCurve(a, 'C01', { id: 'EDGE' }), /already has data/);
});

test('deleting from the template removes the points on every specimen', () => {
  const set = makeSet(3);
  assert.equal(C.specimensWith(set.specimens[0], 'lm', 'LM01'), 3);
  C.removeDef(set.specimens[0], 'LM01');
  assert.ok(set.specimens.every(st => !C.lmEntry(st, 'LM01')));
  C.ensureCurve(set.specimens[1], 'C01');
  assert.equal(C.specimensWith(set.specimens[0], 'curve', 'C01'), 1);
  C.removeCurve(set.specimens[2], 'C01');
  assert.ok(set.specimens.every(st => st.curves.length === 0));
});

test('new ids skip ad hoc ids used on any specimen', () => {
  const set = makeSet(2);
  set.specimens[1].landmarks.push({ id: 'LM04', template_id: null, status: 'placed', position: [1, 1] });
  assert.deepEqual(C.addDefs(set.specimens[0], ['A']), ['LM05']);
});

test('newTemplate and applyTemplate act on every specimen', () => {
  const set = makeSet(2);
  C.applyTemplate(set.specimens[0], C.textToTpl('LM02 | Only', {}));
  assert.ok(set.specimens.every(st => C.lmEntry(st, 'LM01').template_id === null));
  C.newTemplate(set.specimens[1]);
  assert.ok(set.specimens.every(st => st.landmarks.length === 0));
});

test('progress counts done items per specimen', () => {
  const set = makeSet(2);
  assert.deepEqual(C.progress(set.specimens[0]), { done: 1, total: 4 });
  finish(set.specimens[0]);
  assert.deepEqual(C.progress(set.specimens[0]), { done: 4, total: 4 });
  C.setStatus(set.specimens[1], { kind: 'lm', id: 'LM02' }, 'missing');
  assert.deepEqual(C.progress(set.specimens[1]), { done: 2, total: 4 });
});

test('combined TPS has one block per specimen', () => {
  const set = makeSet(2);
  const tps = C.toTPS(set.specimens);
  const blocks = tps.trim().split(/\n(?=LM=)/);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /^LM=6\n1 79\n/);
  assert.match(blocks[0], /IMAGE=fish01\.png\nID=FISH_01$/);
  assert.match(blocks[1], /^LM=6\n2 78\n/);
  assert.match(blocks[1], /ID=FISH_02$/);
});

test('export IDs: plain when unique, _r<n> when any specimen has replicates, _<operator> when shared', () => {
  const set = makeSet(2);
  const [a, b] = set.specimens;
  assert.deepEqual(C.exportIds([a, b]), ['FISH_01', 'FISH_02']);
  b.specimen.id = 'FISH_01'; b.specimen.replicate = 2;
  assert.deepEqual(C.exportIds([a, b]), ['FISH_01_r1', 'FISH_01_r2']);
  b.specimen.replicate = 1;
  a.provenance = { operator: 'Ana K.' }; b.provenance = { operator: 'ben' };
  assert.deepEqual(C.exportIds([a, b]), ['FISH_01_Ana_K', 'FISH_01_ben']);
  b.specimen.replicate = 2;
  assert.deepEqual(C.exportIds([a, b]), ['FISH_01_Ana_K_r1', 'FISH_01_ben_r2']);
});

test('combined CSV has tps_id, specimen, replicate and operator columns', () => {
  const set = makeSet(2);
  set.specimens[1].specimen.id = 'FISH_01';
  set.specimens[1].specimen.replicate = 2;
  for (const st of set.specimens) st.provenance = { operator: 'ana' };
  const lines = C.toCSV(set.specimens).trim().split('\n');
  assert.equal(lines.length, 1 + 2 * 6);
  assert.equal(lines[1], 'FISH_01_r1,FISH_01,1,ana,fish01.png,LM01,LM01,First,landmark,,,1,1,px,placed');
  assert.equal(lines[7], 'FISH_01_r2,FISH_01,2,ana,fish02.png,LM01,LM01,First,landmark,,,2,2,px,placed');
});

test('templateDifference ignores names but not ids, landmarks or curve point counts', () => {
  const a = makeState().template, b = JSON.parse(JSON.stringify(a));
  b.landmarks[0].name = 'Other name'; b.version = '2.0';
  assert.equal(C.templateDifference(a, b), null);
  assert.match(C.templateDifference(a, { ...b, id: 'other' }), /“other”, not “test-tpl”/);
  const c = JSON.parse(JSON.stringify(a)); c.curves[0].n_points = 5;
  assert.match(C.templateDifference(a, c), /different landmarks or curves/);
  const d = JSON.parse(JSON.stringify(a)); d.landmarks.pop();
  assert.match(C.templateDifference(a, d), /different landmarks/);
});

test('zip: files written by zipFiles read back unchanged', async () => {
  const files = [{ name: 'a.lmk.json', data: '{"x":1}\n' }, { name: 'ünïcode name.csv', data: 'a,b\n1,2\n' }, { name: 'bin.dat', data: new Uint8Array([0, 255, 7]) }];
  const zip = C.zipFiles(files, new Date(2026, 10, 7, 12, 0, 0));
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b);
  const back = await C.unzipFiles(zip);
  assert.deepEqual(back.map(f => f.name), files.map(f => f.name));
  assert.equal(new TextDecoder().decode(back[1].data), 'a,b\n1,2\n');
  assert.deepEqual([...back[2].data], [0, 255, 7]);
});

test('zip: the CRC matches the standard value', () => {
  assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

/** A zip with one deflated file and macOS metadata, as Finder makes when re-zipping. */
function deflatedZip(name, text) {
  const data = Buffer.from(text), comp = zlib.deflateRawSync(data), crc = C.crc32(data);
  const nm = Buffer.from(name), junk = Buffer.from('__MACOSX/._' + name);
  const loc = (n, d) => { const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26); return Buffer.concat([h, n, d]); };
  const cen = (n, d, off) => { const h = Buffer.alloc(46); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(8, 10);
    h.writeUInt32LE(crc, 16); h.writeUInt32LE(d.length, 20); h.writeUInt32LE(data.length, 24); h.writeUInt16LE(n.length, 28); h.writeUInt32LE(off, 42); return Buffer.concat([h, n]); };
  const l1 = loc(nm, comp), l2 = loc(junk, comp);
  const c = Buffer.concat([cen(nm, comp, 0), cen(junk, comp, l1.length)]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10);
  end.writeUInt32LE(c.length, 12); end.writeUInt32LE(l1.length + l2.length, 16);
  return new Uint8Array(Buffer.concat([l1, l2, c, end]));
}

test('zip: deflated files are unpacked and macOS metadata is skipped', async () => {
  const back = await C.unzipFiles(deflatedZip('FISH_01.lmk.json', '{"format":"landmark-json"}'.repeat(20)));
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'FISH_01.lmk.json');
  assert.equal(new TextDecoder().decode(back[0].data), '{"format":"landmark-json"}'.repeat(20));
});

test('zip: non-zip data is refused with a readable message', async () => {
  await assert.rejects(C.unzipFiles(new TextEncoder().encode('hello, not a zip')), /not a zip file/);
});

test('hand-in: one .lmk.json per specimen plus combined TPS and CSV, with the operator', () => {
  const set = makeSet(2);
  set.specimens[1].specimen.replicate = 2;
  const files = C.handInFiles(set.specimens, { operator: 'Ana K.', now: NOW });
  assert.deepEqual(files.map(f => f.name), ['FISH_01.lmk.json', 'FISH_02_r2.lmk.json', 'Ana_K_landmarks.tps', 'Ana_K_landmarks.csv']);
  const d = JSON.parse(files[0].data);
  assert.equal(d.provenance.operator, 'Ana K.');
  assert.equal(d.specimen.id, 'FISH_01');
  assert.match(files[3].data, /^tps_id,specimen_id,replicate,operator/);
  assert.match(files[3].data, /\nFISH_01,FISH_01,1,Ana K\.,fish01\.png,LM01/);
});

test('hand-in file names never collide', () => {
  const set = makeSet(2);
  set.specimens[1].specimen.id = 'FISH_01';
  assert.deepEqual(C.handInFiles(set.specimens, { now: NOW }).map(f => f.name).slice(0, 2), ['FISH_01.lmk.json', 'FISH_01_2.lmk.json']);
});

test('combining hand-ins: summary per student, shared specimens, refused and skipped files', () => {
  const docsFor = (op, ids) => {
    const set = C.newSet(makeState().template);
    for (const id of ids) { const st = makeState(); st.specimen = { id, image: { file: id + '.png', sha256: id, width: 100, height: 80 } }; C.joinSet(set, st); C.placeLm(st, 'LM01', [1, 1]); finish(st); }
    return set.specimens.map(st => C.buildDoc(st, { operator: op, now: NOW }));
  };
  const ana = docsFor('ana', ['FISH_01', 'FISH_02']), ben = docsFor('ben', ['FISH_02', 'FISH_03']);
  const other = docsFor('cy', ['FISH_04'])[0]; other.template.id = 'other-template';
  const entries = [
    ...ana.map((doc, i) => ({ source: 'ana.zip', name: `a${i}.lmk.json`, doc })),
    ...ben.map((doc, i) => ({ source: 'ben.zip', name: `b${i}.lmk.json`, doc })),
    { source: 'cy.zip', name: 'c.lmk.json', doc: other },
    { source: 'ana_again.zip', name: 'a0.lmk.json', doc: ana[0] },
    { source: 'junk.zip', name: 'notes.lmk.json', doc: { hello: 1 } },
  ];
  const r = C.combineEntries(entries);
  assert.equal(r.states.length, 4);
  assert.deepEqual(r.refused.map(x => x.name), ['c.lmk.json', 'notes.lmk.json']);
  assert.match(r.refused[0].reason, /other-template/);
  assert.deepEqual(r.skipped.map(x => x.source), ['ana_again.zip']);
  assert.deepEqual(r.operators.map(o => [o.operator, o.specimens, o.complete]), [['ana', 2, 2], ['ben', 2, 2]]);
  assert.deepEqual(r.shared, [{ id: 'FISH_02', operators: 2 }]);
  assert.deepEqual(r.ids, ['FISH_01_ana', 'FISH_02_ana', 'FISH_02_ben', 'FISH_03_ben']);
  assert.match(C.toTPS(r.states, r.ids), /ID=FISH_02_ben\n/);
});

test('galleryView: a square crop centred on the landmark, the same relative size on every specimen', () => {
  const s = makeState(); // 1000 × 800 image
  C.placeLm(s, 'LM01', [500, 400]);
  assert.deepEqual(C.galleryView(s, { kind: 'lm', id: 'LM01' }, 0.05), { state: 'placed', box: [450, 350, 100, 100] });
  s.specimen.image.width = 2000;   // a bigger photo: the crop grows with it
  assert.deepEqual(C.galleryView(s, { kind: 'lm', id: 'LM01' }, 0.05).box, [400, 300, 200, 200]);
});

test('galleryView: missing and unplaced landmarks have no crop', () => {
  const s = makeState();
  assert.deepEqual(C.galleryView(s, { kind: 'lm', id: 'LM01' }, 0.05), { state: 'todo' });
  C.setStatus(s, { kind: 'lm', id: 'LM02' }, 'missing');
  assert.deepEqual(C.galleryView(s, { kind: 'lm', id: 'LM02' }, 0.05), { state: 'missing' });
  C.placeLm(s, 'LM03', [10, 10]); C.setStatus(s, { kind: 'lm', id: 'LM03' }, 'estimated');
  assert.equal(C.galleryView(s, { kind: 'lm', id: 'LM03' }, 0.05).state, 'estimated');
});

test('galleryView: a curve is framed by all its points', () => {
  const s = makeState();
  C.placeLm(s, 'LM02', [100, 100]); C.placeLm(s, 'LM03', [500, 100]);
  C.ensureCurve(s, 'C01').control_points.push({ position: [300, 200] });
  C.recomputeCurves(s);
  const { state, box } = C.galleryView(s, { kind: 'curve', id: 'C01' }, 0);
  assert.equal(state, 'placed');
  const side = 400 * 1.15;
  assert.deepEqual(box.map(v => Math.round(v * 1000) / 1000), [300 - side / 2, 150 - side / 2, side, side].map(v => Math.round(v * 1000) / 1000));
  assert.deepEqual(C.galleryView(makeState(), { kind: 'curve', id: 'C01' }, 0.05), { state: 'todo' });
});

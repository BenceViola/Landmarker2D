'use strict';
// Opening images and files, saving, autosave and exports, as a student would use them.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { openTab, openApp, clickImage, viewScale, getState, download, pngFile, setTemplate, row } = require('./helpers.js');

const TEMPLATE = '# id: mini\n# name: Mini set\n# version: 1.0\nLM01 | Left corner\nLM02 | Right corner\ncurve C01 | Top edge | start=LM01 end=LM02 n=4 path=polyline';

/** Open a 640 × 480 image, set the template and place everything. Returns the image info. */
async function landmarkOwnImage(page, testInfo) {
  const img = pngFile(testInfo, 'spec_A.png', 640, 480, 1);
  await page.locator('#fImg').setInputFiles(img.path);
  await expect(page.locator('#imgMeta')).toContainText('spec_A.png');
  await expect(page.locator('#spId')).toHaveValue('spec_A');
  // a new image after the sample starts with an empty template
  await expect(page.locator('#list')).toContainText('The template is empty');
  await setTemplate(page, TEMPLATE);
  await expect(row(page, 'LM01')).toHaveClass(/sel/);
  await clickImage(page, [100.5, 200.5]);
  await clickImage(page, [500.5, 200.5]);
  await expect(row(page, 'C01')).toHaveClass(/sel/);
  await clickImage(page, [300.5, 150.5]);
  await expect(page.locator('#tplCount')).toHaveText('3 of 3 done');
  return img;
}

test('a full session: own image, template, placing, save .lmk.json', async ({ page }, testInfo) => {
  const errors = await openApp(page);
  const img = await landmarkOwnImage(page, testInfo);
  await openTab(page, 'Specimen');
  await page.locator('#opName').fill('student01');
  await page.locator('#opName').blur();
  const { name, text } = await download(page, '#bSave');
  expect(name).toBe('spec_A.lmk.json');
  const d = JSON.parse(text);
  expect(d.format).toBe('landmark-json');
  expect(d.version).toBe('0.2.0');
  expect(d.specimen.image).toEqual({ file: 'spec_A.png', sha256: img.sha256, width: 640, height: 480 });
  expect(d.template.dimensions).toBe(2);
  expect(d.landmarks.map(e => e.id)).toEqual(['LM01', 'LM02']);
  const tol = 1 / (await viewScale(page));
  expect(Math.abs(d.landmarks[0].position[0] - 100.5)).toBeLessThanOrEqual(tol);
  expect(d.curves[0].points).toHaveLength(4);
  expect(d.curves[0].control_points).toHaveLength(1);
  expect(d.provenance.operator).toBe('student01');
  expect(d.provenance.software).toBe('landmarker-2d');
  for (const e of d.landmarks) expect(e.anchor).toBeUndefined();
  expect(errors).toEqual([]);
});

test('TPS and CSV exports', async ({ page }, testInfo) => {
  await openApp(page);
  await landmarkOwnImage(page, testInfo);
  const st = await getState(page);
  const lm1 = st.landmarks.find(e => e.id === 'LM01').position;

  const tps = await download(page, '#bTps');
  expect(tps.name).toBe('spec_A.tps');
  const lines = tps.text.trim().split('\n');
  expect(lines[0]).toBe('LM=6');
  const [x, y] = lines[1].split(' ').map(Number);
  expect(x).toBeCloseTo(lm1[0], 5);
  expect(y).toBeCloseTo(480 - lm1[1], 5);
  expect(lines).toContain('IMAGE=spec_A.png');
  expect(lines).toContain('ID=spec_A');
  expect(tps.text).not.toContain('SCALE=');

  const csv = await download(page, '#bCsv');
  expect(csv.name).toBe('spec_A.csv');
  const rows = csv.text.trim().split('\n');
  expect(rows).toHaveLength(7);
  expect(rows[1]).toMatch(/^spec_A,spec_A,1,,spec_A\.png,LM01,LM01,Left corner,landmark,,,[\d.]+,[\d.]+,px,placed$/);
  expect(rows[3]).toMatch(/,C01_01,C01,Top edge,curve,C01,1,/);
});

test('saving a template and loading it into a new session', async ({ page }, testInfo) => {
  await openApp(page);
  await landmarkOwnImage(page, testInfo);
  await openTab(page, 'Template');
  const tpl = await download(page, '[data-act="tpl-save"]');
  expect(tpl.name).toBe('mini.template.json');
  const t = JSON.parse(tpl.text);
  expect(t.dimensions).toBe(2);
  const tplPath = testInfo.outputPath('mini.template.json');
  fs.writeFileSync(tplPath, tpl.text);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  const other = pngFile(testInfo, 'spec_B.png', 300, 200, 2);
  await page.locator('#fImg').setInputFiles(other.path);
  await expect(page.locator('#imgMeta')).toContainText('spec_B.png');
  await page.locator('#fTpl').setInputFiles(tplPath);
  await expect(page.locator('#tplName')).toHaveText('Mini set');
  await expect(page.locator('#tplCount')).toHaveText('0 of 3 done');
});

test('unsaved work comes back when the same image is opened again', async ({ page }, testInfo) => {
  await openApp(page);
  const img = await landmarkOwnImage(page, testInfo);
  await expect(page.locator('#sSave')).toContainText('kept in this browser');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.locator('#fImg').setInputFiles(img.path);
  await expect(page.locator('#toast')).toContainText('Restored your unsaved work');
  await expect(page.locator('#tplCount')).toHaveText('3 of 3 done');
  await expect(page.locator('#tplName')).toHaveText('Mini set');
});

test('re-opening a saved .lmk.json and then its image', async ({ page }, testInfo) => {
  await openApp(page);
  const img = await landmarkOwnImage(page, testInfo);
  const saved = await download(page, '#bSave');
  const savedPath = testInfo.outputPath('spec_A.lmk.json');
  fs.writeFileSync(savedPath, saved.text);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.locator('#fDoc').setInputFiles(savedPath);
  await expect(page.locator('#toast')).toContainText('Now open spec_A.png');
  await expect(page.locator('#imgMeta')).toContainText('image not open');
  await expect(page.locator('#tplCount')).toHaveText('3 of 3 done');
  await page.locator('#fImg').setInputFiles(img.path);
  await expect(page.locator('#imgMeta')).not.toContainText('image not open');
  const st = await getState(page);
  expect(st.warn).toBeNull();
  expect(st.hasImage).toBe(true);
  // saving again reproduces the same landmark data
  const again = JSON.parse((await download(page, '#bSave')).text);
  const first = JSON.parse(saved.text);
  expect(again.landmarks).toEqual(first.landmarks);
  expect(again.curves).toEqual(first.curves);
  expect(again.provenance.created).toBe(first.provenance.created);
});

test('opening a file against a different image shows a warning', async ({ page }, testInfo) => {
  await openApp(page);
  await landmarkOwnImage(page, testInfo);
  const savedPath = testInfo.outputPath('spec_A.lmk.json');
  fs.writeFileSync(savedPath, (await download(page, '#bSave')).text);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.locator('#fDoc').setInputFiles(savedPath);
  const wrong = pngFile(testInfo, 'spec_A_resized.png', 320, 240, 1);
  await page.locator('#fImg').setInputFiles(wrong.path);
  await expect(page.locator('#warnSec')).toBeVisible();
  await expect(page.locator('#warnSec')).toContainText('checksum differs');
  await expect(page.locator('#warnSec')).toContainText('320 × 240');
  await page.locator('[data-act="dismiss-warn"]').click();
  await expect(page.locator('#warnSec')).toBeHidden();
});

test('3D files, wrong templates and non-JSON files are refused with a message', async ({ page }, testInfo) => {
  await openApp(page);
  const mesh = testInfo.outputPath('skull.lmk.json');
  fs.writeFileSync(mesh, JSON.stringify({ format: 'landmark-json', version: '0.1.0',
    specimen: { id: 'S', mesh: { file: 'S.ply', units: 'mm' } }, template: { id: 't', landmarks: [] }, landmarks: [] }));
  await page.locator('#fDoc').setInputFiles(mesh);
  await expect(page.locator('#toast')).toContainText('3D mesh data');

  const tpl3d = testInfo.outputPath('cranium.template.json');
  fs.writeFileSync(tpl3d, JSON.stringify({ id: 'c', dimensions: 3, landmarks: [{ id: 'LM01', name: 'Nasion' }] }));
  await page.locator('#fTpl').setInputFiles(tpl3d);
  await expect(page.locator('#toast')).toContainText('3D data');

  const junk = testInfo.outputPath('notes.json');
  fs.writeFileSync(junk, '{ not json');
  await page.locator('#fDoc').setInputFiles(junk);
  await expect(page.locator('#toast')).toContainText('not valid JSON');
  // the sample is untouched
  await expect(page.locator('#tplCount')).toHaveText('5 of 7 done');
});

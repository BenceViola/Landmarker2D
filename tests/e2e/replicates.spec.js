'use strict';
// Replicates (format v0.3): landmark a specimen again, blind; repeatability; exports and resuming.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const C = require('../../src/core.js');
const { openTab, openApp, clickImage, getState, download, downloadBytes, pngFile, setTemplate, row } = require('./helpers.js');

const TEMPLATE = '# id: fish-basic\n# name: Fish, basic\nLM01 | Snout tip\nLM02 | Eye centre\nLM03 | Tail base';
const POS = [[50, 150], [120, 130], [350, 150]];
const thumbs = page => page.locator('#strip .thumb[data-uid]');
const cur = page => page.evaluate(() => ({ id: window.__lmk.cur.specimen.id, rep: window.__lmk.cur.specimen.replicate || 1 }));

/** Two fish, FISH_01 fully placed, then a second replicate of FISH_01 (in template order unless shuffle). */
async function setUp(page, testInfo, { shuffle = false } = {}) {
  await openApp(page);
  const imgs = [1, 2].map(i => pngFile(testInfo, `FISH_0${i}.png`, 400, 300, i));
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await setTemplate(page, TEMPLATE);
  for (const p of POS) await clickImage(page, p);
  await openTab(page, 'Specimen');
  await expect(page.locator('#repShuffle')).not.toBeChecked();   // template order by default
  if (shuffle) await page.locator('#repShuffle').check();
  await page.locator('[data-act="rep-new"]').click();
  return imgs;
}
/** Place all three landmarks on the current replicate, offset from POS by (dx, dy). */
async function placeOffset(page, dx, dy) {
  await openTab(page, 'Landmarks');
  for (const id of ['LM01', 'LM02', 'LM03']) {
    await row(page, id).click();
    const p = POS[Number(id.slice(2)) - 1];
    await clickImage(page, [p[0] + dx, p[1] + dy]);
  }
}

test('"Landmark again" adds an empty replicate on the same image, next to the original', async ({ page }, testInfo) => {
  const errors = await openApp(page);
  await setUp(page, testInfo);
  expect(await cur(page)).toEqual({ id: 'FISH_01', rep: 2 });
  await expect(thumbs(page)).toHaveCount(3);
  await expect(thumbs(page).nth(0).locator('.tname')).toHaveText('FISH_01 r1');
  await expect(thumbs(page).nth(1).locator('.tname')).toHaveText('FISH_01 r2');
  await expect(thumbs(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(thumbs(page).nth(2).locator('.tname')).toHaveText('FISH_02');
  await expect(thumbs(page).nth(1).locator('.badge')).toHaveText('0/3');
  const st = await getState(page);
  expect(st.landmarks).toEqual([]);
  expect(st.specimen.image.sha256).toBe(await page.evaluate(() => window.__lmk.set.specimens[0].specimen.image.sha256));
  expect(st.sel).toEqual({ kind: 'lm', id: 'LM01' });
  await expect(page.locator('#sSpec')).toHaveText('FISH_01 r2 · 2 of 3');
  await expect(page.locator('#repSec')).toContainText('r1 3/3');
  await expect(page.locator('#repSec')).toContainText('r2 0/3');
  expect(errors).toEqual([]);
});

test('random order: the replicate gets a shuffled placing order', async ({ page }, testInfo) => {
  await setUp(page, testInfo, { shuffle: true });
  const order = await page.evaluate(() => window.__lmk.cur.order);
  expect([...order].sort()).toEqual(['LM01', 'LM02', 'LM03']);
  expect(await page.evaluate(() => window.__lmk.S.sel.id)).toBe(order[0]);
  await openTab(page, 'Landmarks');
  await clickImage(page, [60, 60]);
  expect(await page.evaluate(() => window.__lmk.S.sel.id)).toBe(order[1]);
});

test('compare view hides the other replicate until this one is finished', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await openTab(page, 'Landmarks');
  await page.keyboard.press('g');
  const r1 = page.locator('#gallery .gtile').nth(0);
  await expect(r1).toHaveAttribute('data-hidden', 'true');
  await expect(r1).toContainText('hidden until this replicate is finished');
  await expect(page.locator('#gallery .gtile').nth(2)).toHaveAttribute('data-hidden', 'false');   // another specimen
  await page.keyboard.press('g');
  await placeOffset(page, 4, 3);
  await page.keyboard.press('g');
  await expect(r1).toHaveAttribute('data-hidden', 'false');
  await expect(r1).toHaveAttribute('data-state', 'placed');
});

test('repeatability shows how far apart the replicates landed', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await placeOffset(page, 3, 4);   // every landmark 5 px from the first replicate
  await openTab(page, 'Specimen');
  await page.locator('[data-act="rep-summary"]').click();
  const dlg = page.locator('#dRep');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('1 specimen landmarked more than once (FISH_01 ×2)');
  await expect(dlg).toContainText('In pixels');
  await expect(dlg.locator('tbody tr')).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const avg = Number(await dlg.locator('tbody tr').nth(i).locator('td').nth(2).textContent());
    expect(avg).toBeGreaterThan(4); expect(avg).toBeLessThan(6);
  }
  await page.locator('#repClose').click();
});

test('repeatability is in millimetres when the specimens have a scale, and flags outliers', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  // set 0.1 mm/px on both replicates
  for (const r of [0, 1]) {
    await page.evaluate(i => { window.__lmk.set.specimens[i].specimen.image.scale = { value: 0.1, units: 'mm', method: 'manual' }; }, r);
  }
  await openTab(page, 'Landmarks');
  await row(page, 'LM01').click(); await clickImage(page, [51, 150]);
  await row(page, 'LM02').click(); await clickImage(page, [121, 130]);
  await row(page, 'LM03').click(); await clickImage(page, [370, 150]);   // 20 px off
  await openTab(page, 'Specimen');
  await page.locator('[data-act="rep-summary"]').click();
  const first = page.locator('#dRep tbody tr').first();
  await expect(page.locator('#dRep th').nth(2)).toHaveText('Average (mm)');
  await expect(first).toContainText('LM03');
  await expect(first).toHaveClass(/flag/);
  await expect(first.locator('.chip')).toHaveText('check');
  const avg = Number(await first.locator('td').nth(2).textContent());
  expect(avg).toBeGreaterThan(1.8); expect(avg).toBeLessThan(2.2);
});

test('hand-in and exports name replicates as the spec says', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await placeOffset(page, 2, 2);
  const tps = await download(page, '#bTps');
  expect(tps.text.match(/^ID=.*$/gm)).toEqual(['ID=FISH_01_r1', 'ID=FISH_01_r2', 'ID=FISH_02_r1']);
  const csv = await download(page, '#bCsv');
  expect(csv.text.split('\n')[4]).toMatch(/^FISH_01_r2,FISH_01,2,/);

  await page.locator('#bHandin').click();
  await expect(page.locator('#hiSummary')).toContainText('FISH_01 r2');
  await page.locator('#hiName').fill('Ana');
  const zip = await downloadBytes(page, '#dHandin button[type="submit"]');
  const files = await C.unzipFiles(zip.bytes);
  expect(files.map(f => f.name)).toEqual(['FISH_01.lmk.json', 'FISH_01_r2.lmk.json', 'FISH_02.lmk.json', 'Ana_landmarks.tps', 'Ana_landmarks.csv']);
  const r2 = JSON.parse(new TextDecoder().decode(files[1].data));
  expect(r2.version).toBe('0.3.0');
  expect(r2.specimen).toMatchObject({ id: 'FISH_01', replicate: 2 });
  expect(r2.landmarks).toHaveLength(3);
  const r1 = JSON.parse(new TextDecoder().decode(files[0].data));
  expect(r1.version).toBe('0.2.0');
  expect(r1.specimen.replicate).toBeUndefined();
  fs.writeFileSync(testInfo.outputPath('handin.zip'), zip.bytes);
});

test('a hand-in with replicates opens again, and one image serves both replicates', async ({ page }, testInfo) => {
  const imgs = await setUp(page, testInfo);
  await placeOffset(page, 2, 2);
  await page.locator('#bHandin').click();
  await page.locator('#hiName').fill('Ana');
  const zip = await downloadBytes(page, '#dHandin button[type="submit"]');
  const zipPath = testInfo.outputPath('handin.zip');
  fs.writeFileSync(zipPath, zip.bytes);

  const fresh = await page.context().browser().newPage();
  await openApp(fresh);
  await fresh.locator('#fDoc').setInputFiles(zipPath);
  await expect(thumbs(fresh)).toHaveCount(3);
  await expect(thumbs(fresh).nth(1).locator('.tname')).toHaveText('FISH_01 r2');
  await fresh.locator('#fImg').setInputFiles(imgs[0].path);
  await expect(thumbs(fresh).nth(0)).not.toHaveClass(/noimg/);
  await expect(thumbs(fresh).nth(1)).not.toHaveClass(/noimg/);
  await expect(thumbs(fresh).nth(2)).toHaveClass(/noimg/);
  await fresh.close();
});

test('replicates saved in the browser come back when the image is opened again', async ({ page }, testInfo) => {
  const imgs = await setUp(page, testInfo);
  await placeOffset(page, 2, 2);
  await expect(page.locator('#sSave')).toContainText('kept in this browser');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await expect(thumbs(page)).toHaveCount(3);
  await expect(thumbs(page).nth(1).locator('.tname')).toHaveText('FISH_01 r2');
  await expect(thumbs(page).nth(1).locator('.badge')).toHaveText('3/3');
});

test('renaming a specimen renames its replicates; Repeatability waits for a replicate', async ({ page }, testInfo) => {
  await openApp(page);
  const imgs = [1, 2].map(i => pngFile(testInfo, `FISH_0${i}.png`, 400, 300, i));
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await setTemplate(page, TEMPLATE);
  await openTab(page, 'Specimen');
  await expect(page.locator('[data-act="rep-summary"]')).toBeDisabled();
  await page.locator('[data-act="rep-new"]').click();
  await page.locator('#spId').fill('PERCH_01');
  await page.locator('#spNotes').click();
  const ids = await page.evaluate(() => window.__lmk.set.specimens.map(r => r.specimen.id));
  expect(ids).toEqual(['PERCH_01', 'PERCH_01', 'FISH_02']);
  await expect(page.locator('[data-act="rep-summary"]')).toBeEnabled();
});

'use strict';
// Specimen sets: several images, switching, shared template, hand-in and combining hand-ins.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const C = require('../../src/core.js');
const { openTab, openApp, clickImage, getState, download, downloadBytes, pngFile, setTemplate, row } = require('./helpers.js');

const TEMPLATE = '# id: fish-basic\n# name: Fish, basic\n# version: 1.0\nLM01 | Snout tip\nLM02 | Eye centre\nLM03 | Tail base';
const thumbs = page => page.locator('#strip .thumb[data-uid]');
const thumb = (page, i) => thumbs(page).nth(i);
const badge = (page, i) => thumb(page, i).locator('.badge');
const currentId = page => page.evaluate(() => window.__lmk.cur.specimen.id);

/** Open n test images at once and set the fish template. Returns the image infos. */
async function openFish(page, testInfo, n = 3) {
  const imgs = Array.from({ length: n }, (_, i) => pngFile(testInfo, `FISH_0${i + 1}.png`, 400, 300, i + 1));
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await expect(thumbs(page)).toHaveCount(n);
  await setTemplate(page, TEMPLATE);
  return imgs;
}
async function placeAll(page) {
  for (const p of [[50, 150], [120, 130], [350, 150]]) await clickImage(page, p);
}

test('opening several images makes a set; the sample makes way', async ({ page }, testInfo) => {
  const errors = await openApp(page);
  await expect(thumbs(page)).toHaveCount(1);
  await expect(badge(page, 0)).toHaveText('5/7');
  await openFish(page, testInfo);
  await expect(page.locator('#sampleTag')).toBeHidden();
  await expect(thumb(page, 0).locator('.tname')).toHaveText('FISH_01');
  await expect(thumb(page, 0)).toHaveAttribute('aria-current', 'true');
  for (let i = 0; i < 3; i++) {
    await expect(badge(page, i)).toHaveText('0/3');
    await expect(badge(page, i)).not.toHaveClass(/ok/);
  }
  await expect(page.locator('#sSpec')).toHaveText('FISH_01 · 1 of 3');
  await expect(page.locator('#strip .thumb.add')).toBeVisible();
  expect(errors).toEqual([]);
});

test('each specimen keeps its own landmarks; the badge turns green when done', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo);
  await clickImage(page, [50, 150]);
  await expect(badge(page, 0)).toHaveText('1/3');
  await clickImage(page, [120, 130]);
  await clickImage(page, [350, 150]);
  await expect(badge(page, 0)).toHaveText('3/3');
  await expect(badge(page, 0)).toHaveClass(/ok/);

  await thumb(page, 1).click();
  expect(await currentId(page)).toBe('FISH_02');
  await expect(row(page, 'LM01')).toHaveAttribute('data-state', 'todo');
  await expect(page.locator('#tplCount')).toHaveText('0 of 3 done');
  await page.keyboard.press('m');
  await expect(badge(page, 1)).toHaveText('1/3');
  await thumb(page, 0).click();
  await expect(page.locator('#tplCount')).toHaveText('3 of 3 done');
});

test('[ and ] move between specimens', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo);
  await page.keyboard.press(']');
  expect(await currentId(page)).toBe('FISH_02');
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  expect(await currentId(page)).toBe('FISH_03');
  await expect(page.locator('#toast')).toContainText('last specimen');
  await page.keyboard.press('[');
  expect(await currentId(page)).toBe('FISH_02');
  await expect(thumb(page, 1)).toHaveAttribute('aria-current', 'true');
});

test('the template is shared: edits show on every specimen, deletes say how many are affected', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 2);
  await clickImage(page, [50, 150]);
  await page.keyboard.press(']');
  await row(page, 'LM01').click();   // the selection had moved on to LM02
  await clickImage(page, [60, 150]);

  await openTab(page, 'Template');
  const name = page.locator('.tpl-item[data-row="LM02"] .tpl-name');
  await name.fill('Eye, centre of pupil');
  await name.press('Enter');
  await expect(page.locator('.tpl-item[data-row="LM01"] .tpl-id')).toHaveAttribute('readonly', '');
  await page.locator('.tpl-item[data-row="LM01"] [data-act="del"]').click();
  await expect(page.locator('.tpl-item[data-row="LM01"] .tpl-confirm')).toContainText('its placed points on 2 specimens');
  await page.locator('.tpl-item[data-row="LM01"]').getByRole('button', { name: 'Delete', exact: true }).click();

  const st = await page.evaluate(() => window.__lmk.set.specimens.map(r => r.landmarks.length));
  expect(st).toEqual([0, 0]);
  await openTab(page, 'Landmarks');
  await page.keyboard.press('[');
  await expect(row(page, 'LM02')).toContainText('Eye, centre of pupil');
  await expect(badge(page, 0)).toHaveText('0/2');
});

test('undo goes back to the specimen that changed', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 2);
  await page.keyboard.press(']');
  await clickImage(page, [50, 150]);
  await page.keyboard.press('[');
  expect(await currentId(page)).toBe('FISH_01');
  await page.keyboard.press('Control+z');
  expect(await currentId(page)).toBe('FISH_02');
  await expect(badge(page, 1)).toHaveText('0/3');
});

test('Export TPS and CSV cover every specimen', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 2);
  await placeAll(page);
  await openTab(page, 'Specimen');
  await page.locator('#opName').fill('Ana K');
  await page.locator('#opName').blur();
  const tps = await download(page, '#bTps');
  expect(tps.name).toBe('Ana_K_landmarks.tps');
  const blocks = tps.text.trim().split(/\n(?=LM=)/);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]).toContain('ID=FISH_01');
  expect(blocks[1]).toContain('ID=FISH_02');
  expect(blocks[1]).toContain('-999 -999');
  await expect(page.locator('#toast')).toContainText('3 points were not done');
  const csv = await download(page, '#bCsv');
  const lines = csv.text.trim().split('\n');
  expect(lines).toHaveLength(1 + 6);
  expect(lines[1]).toMatch(/^FISH_01,FISH_01,1,Ana K,FISH_01\.png,LM01,/);
});

test('hand-in: asks for a name, then downloads one zip with everything', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 2);
  await placeAll(page);
  await page.locator('#bHandin').click();
  const dlg = page.locator('#dHandin');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('2 specimens');
  await expect(dlg).toContainText('1 specimen isn’t finished');
  await dlg.getByRole('button', { name: 'Download zip' }).click();
  await expect(page.locator('#hiErr')).toContainText('Enter your name');

  await page.locator('#hiName').fill('Ana K');
  const zip = await downloadBytes(page, '#dHandin button[type="submit"]');
  expect(zip.name).toBe('Ana_K_landmarks.zip');
  const files = await C.unzipFiles(zip.bytes);
  expect(files.map(f => f.name)).toEqual(['FISH_01.lmk.json', 'FISH_02.lmk.json', 'Ana_K_landmarks.tps', 'Ana_K_landmarks.csv']);
  const d = JSON.parse(new TextDecoder().decode(files[0].data));
  expect(d.provenance.operator).toBe('Ana K');
  expect(d.landmarks).toHaveLength(3);
  expect(d.template.id).toBe('fish-basic');
  await openTab(page, 'Specimen');
  await expect(page.locator('#opName')).toHaveValue('Ana K');
});

test('a hand-in zip opens again as a set, and its images attach', async ({ page }, testInfo) => {
  await openApp(page);
  const imgs = await openFish(page, testInfo, 2);
  await placeAll(page);
  await page.locator('#bHandin').click();
  await page.locator('#hiName').fill('Ana K');
  const zip = await downloadBytes(page, '#dHandin button[type="submit"]');
  const zipPath = testInfo.outputPath(zip.name);
  fs.writeFileSync(zipPath, zip.bytes);

  // a fresh browser, so nothing is restored from saved work
  const fresh = await page.context().browser().newPage();
  await openApp(fresh);
  await fresh.locator('#fDoc').setInputFiles(zipPath);
  await expect(thumbs(fresh)).toHaveCount(2);
  await expect(fresh.locator('#toast')).toContainText('Now open their 2 images');
  await expect(thumb(fresh, 0)).toHaveClass(/noimg/);
  await expect(badge(fresh, 0)).toHaveText('3/3');
  await fresh.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await expect(thumb(fresh, 0)).not.toHaveClass(/noimg/);
  await expect(thumb(fresh, 1)).not.toHaveClass(/noimg/);
  await expect(fresh.locator('#warnSec')).toBeHidden();
  const st = await getState(fresh);
  expect(st.hasImage).toBe(true);
  expect(st.template.id).toBe('fish-basic');
  await fresh.close();
});

test('unsaved work on several images comes back when they are opened again', async ({ page }, testInfo) => {
  await openApp(page);
  const imgs = await openFish(page, testInfo, 2);
  await clickImage(page, [50, 150]);
  await page.keyboard.press(']');
  await page.keyboard.press('m');
  await expect(page.locator('#sSave')).toContainText('kept in this browser');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await expect(page.locator('#toast')).toContainText('saved work restored for 2');
  await expect(badge(page, 0)).toHaveText('1/3');
  await expect(badge(page, 1)).toHaveText('1/3');
});

test('files made with a different template, and images already open, are refused', async ({ page }, testInfo) => {
  await openApp(page);
  const imgs = await openFish(page, testInfo, 2);
  const other = { format: 'landmark-json', version: '0.2.0',
    specimen: { id: 'OTHER', image: { file: 'o.png', sha256: 'x', width: 10, height: 10 } },
    template: { id: 'leaf-basic', dimensions: 2, landmarks: [{ id: 'LM01', name: 'Base' }] }, landmarks: [] };
  const path = testInfo.outputPath('OTHER.lmk.json');
  fs.writeFileSync(path, JSON.stringify(other));
  await page.locator('#fDoc').setInputFiles(path);
  await expect(page.locator('#toast')).toContainText('OTHER.lmk.json was not opened');
  await expect(page.locator('#toast')).toContainText('“leaf-basic”, not “fish-basic”');
  await expect(thumbs(page)).toHaveCount(2);
  await page.locator('#fImg').setInputFiles(imgs[0].path);
  await expect(page.locator('#toast')).toContainText('1 image was already open');
  await expect(thumbs(page)).toHaveCount(2);
});

test('a specimen can be removed from the set after confirming', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 3);
  await page.keyboard.press(']');
  await openTab(page, 'Specimen');
  await page.locator('[data-act="remove-spec"]').click();
  await expect(page.locator('#spActions')).toContainText('Remove FISH_02 from the set?');
  await page.locator('[data-act="remove-no"]').click();
  await expect(thumbs(page)).toHaveCount(3);
  await page.locator('[data-act="remove-spec"]').click();
  await page.locator('[data-act="remove-yes"]').click();
  await expect(thumbs(page)).toHaveCount(2);
  expect(await currentId(page)).toBe('FISH_03');
});

test('renaming a specimen to an ID already in the set is refused', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 2);
  await openTab(page, 'Specimen');
  await page.locator('#spId').fill('FISH_02');
  await page.locator('#spId').press('Enter');
  await page.locator('#spNotes').click();
  await expect(page.locator('#toast')).toContainText('already called FISH_02');
  await expect(page.locator('#spId')).toHaveValue('FISH_01');
  await page.locator('#spId').fill('PERCH_01');
  await page.locator('#spNotes').click();
  await expect(thumb(page, 0).locator('.tname')).toHaveText('PERCH_01');
});

/** A student's hand-in zip, made with the app's own code. */
function handInZip(testInfo, operator, ids, templateId = 'fish-basic') {
  const set = C.newSet(C.textToTpl(TEMPLATE.replace('fish-basic', templateId), {}));
  ids.forEach((id, i) => {
    const st = C.newState();
    st.specimen = { id, image: { file: `${id}.png`, sha256: `${id}-sha`, width: 400, height: 300 } };
    C.joinSet(set, st);
    C.placeLm(st, 'LM01', [10 + i, 20]); C.placeLm(st, 'LM02', [30, 40]);
    if (operator !== 'cy') C.placeLm(st, 'LM03', [50, 60]);
  });
  const path = testInfo.outputPath(`${operator}_landmarks.zip`);
  fs.writeFileSync(path, C.zipFiles(C.handInFiles(set.specimens, { operator })));
  return path;
}

test('combining hand-ins from several students', async ({ page }, testInfo) => {
  await openApp(page);
  const ana = handInZip(testInfo, 'ana', ['FISH_01', 'FISH_02']);
  const ben = handInZip(testInfo, 'ben', ['FISH_02', 'FISH_03']);
  const cy = handInZip(testInfo, 'cy', ['FISH_04']);
  const odd = handInZip(testInfo, 'dee', ['FISH_05'], 'other-protocol');

  await openTab(page, 'Specimen');
  await page.locator('[data-act="combine"]').click();
  await expect(page.locator('#dCombine')).toBeVisible();
  await expect(page.locator('#cbTps')).toBeDisabled();
  await page.locator('#fCombine').setInputFiles([ana, ben, cy, odd]);
  const res = page.locator('#cbResult');
  await expect(res).toContainText('5 specimens from 3 students');
  await expect(res.locator('tbody tr')).toHaveCount(3);
  await expect(res.locator('tbody tr').nth(2)).toContainText('cy');
  await expect(res.locator('tbody tr').nth(2).locator('td').nth(2)).toHaveText('0');
  await expect(res).toContainText('Done by more than one student: FISH_02 (2)');
  await expect(res).toContainText('FISH_02_ana');
  await expect(res).toContainText('Not combined');
  await expect(res).toContainText('dee_landmarks.zip › FISH_05.lmk.json');

  const tps = await download(page, '#cbTps');
  expect(tps.name).toBe('combined_landmarks.tps');
  const ids = tps.text.match(/^ID=.*$/gm);
  expect(ids).toEqual(['ID=FISH_01_ana', 'ID=FISH_02_ana', 'ID=FISH_02_ben', 'ID=FISH_03_ben', 'ID=FISH_04_cy']);
  const csv = await download(page, '#cbCsv');
  expect(csv.text.split('\n')[1]).toMatch(/^FISH_01_ana,FISH_01,1,ana,/);
  // the open set is untouched
  await page.locator('#cbClose').click();
  await expect(thumbs(page)).toHaveCount(1);
  await expect(page.locator('#sampleTag')).toBeVisible();
});

test('switching specimens starts at the first unfinished landmark', async ({ page }, testInfo) => {
  await openApp(page);
  await openFish(page, testInfo, 3);
  await placeAll(page);   // the selection stays on LM03, the last one placed
  const sel = () => page.evaluate(() => window.__lmk.S.sel);
  await page.keyboard.press(']');
  expect(await sel()).toEqual({ kind: 'lm', id: 'LM01' });
  await expect(row(page, 'LM01')).toHaveClass(/sel/);
  await clickImage(page, [50, 150]);   // lands on LM01 of FISH_02
  expect((await getState(page)).landmarks.map(e => e.id)).toEqual(['LM01']);

  await page.keyboard.press(']');
  await page.keyboard.press('[');   // back to the half-done FISH_02: first gap
  expect(await sel()).toEqual({ kind: 'lm', id: 'LM02' });
  await page.keyboard.press('[');   // FISH_01 is finished: nothing selected, so no point moves by accident
  expect(await sel()).toBeNull();
  await expect(page.locator('#hint')).toContainText('All template points are done');
});

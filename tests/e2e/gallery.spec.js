'use strict';
// The compare view: the selected landmark or curve on every specimen.
const { test, expect } = require('@playwright/test');
const { openApp, clickImage, imgToPage, getState, pngFile, setTemplate, row } = require('./helpers.js');

const TEMPLATE = '# id: fish-basic\n# name: Fish, basic\nLM01 | Snout tip\nLM02 | Eye centre\nLM03 | Tail base\ncurve C01 | Back | start=LM01 end=LM03 n=5 path=polyline';
const tiles = page => page.locator('#gallery .gtile');
const tile = (page, i) => tiles(page).nth(i);
const boxOf = async (page, i) => (await tile(page, i).getAttribute('data-box')).split(',').map(Number);
const currentId = page => page.evaluate(() => window.__lmk.cur.specimen.id);

/** Three fish: LM01 placed on 1 and 2 (at different spots), missing on 3; LM01 selected. */
async function setUp(page, testInfo) {
  await openApp(page);
  const imgs = [1, 2, 3].map(i => pngFile(testInfo, `FISH_0${i}.png`, 400, 300, i));
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await setTemplate(page, TEMPLATE);
  await clickImage(page, [100, 100]);
  await page.keyboard.press(']');
  await clickImage(page, [150, 120]);
  await page.keyboard.press(']');
  await page.keyboard.press('m');
  await row(page, 'LM01').click();
}

test('G opens the compare view with one tile per specimen', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await page.keyboard.press('g');
  await expect(page.locator('#gallery')).toBeVisible();
  await expect(page.locator('#strip')).toBeHidden();
  await expect(page.locator('#vCompare')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#galHead')).toHaveText('LM01 Snout tip on 3 specimens');
  await expect(tiles(page)).toHaveCount(3);
  await expect(tile(page, 0)).toHaveAttribute('data-state', 'placed');
  await expect(tile(page, 2)).toHaveAttribute('data-state', 'missing');
  await expect(tile(page, 2)).toContainText('marked missing');
  await expect(tile(page, 2)).toHaveAttribute('aria-current', 'true');
  // each crop is centred on that specimen's LM01
  const [x, y, w] = await boxOf(page, 1);
  expect(x + w / 2).toBeCloseTo(150, 0);
  expect(y + w / 2).toBeCloseTo(120, 0);
  // and the same size on both (same image size)
  expect((await boxOf(page, 0))[2]).toBeCloseTo(w, 6);
  await page.keyboard.press('g');
  await expect(page.locator('#strip')).toBeVisible();
  await expect(page.locator('#gallery')).toBeHidden();
});

test('Closer and Wider change the crop size, within limits', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await page.locator('#vCompare').click();
  const w0 = (await boxOf(page, 0))[2];
  await page.locator('#galCloser').click();
  await expect.poll(async () => (await boxOf(page, 0))[2]).toBeLessThan(w0);
  await page.locator('#galCloser').click();
  await expect(page.locator('#galCloser')).toBeDisabled();
  for (let i = 0; i < 4; i++) await page.locator('#galWider').click();
  await expect(page.locator('#galWider')).toBeDisabled();
  await expect.poll(async () => (await boxOf(page, 0))[2]).toBeGreaterThan(w0);
});

test('clicking a tile opens that specimen with the landmark still selected, ready to fix', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await page.keyboard.press('g');
  await tile(page, 0).click();
  expect(await currentId(page)).toBe('FISH_01');
  expect(await page.evaluate(() => window.__lmk.S.sel)).toEqual({ kind: 'lm', id: 'LM01' });
  await expect(tile(page, 0)).toHaveAttribute('aria-current', 'true');
  // fix it by dragging; the tile follows
  const before = (await getState(page)).landmarks.find(e => e.id === 'LM01').position;
  const [px, py] = await imgToPage(page, before);
  await page.mouse.move(px, py); await page.mouse.down();
  await page.mouse.move(px + 30, py, { steps: 4 }); await page.mouse.up();
  const after = (await getState(page)).landmarks.find(e => e.id === 'LM01').position;
  await expect.poll(async () => { const [x, , w] = await boxOf(page, 0); return x + w / 2; }).toBeCloseTo(after[0], 3);

  // a missing landmark can be placed straight from its tile
  await tile(page, 2).click();
  expect(await currentId(page)).toBe('FISH_03');
  await clickImage(page, [120, 110]);
  await expect(tile(page, 2)).toHaveAttribute('data-state', 'placed');
  // the compare view stays on LM01 instead of moving on to the next landmark
  expect(await page.evaluate(() => window.__lmk.S.sel)).toEqual({ kind: 'lm', id: 'LM01' });
  await expect(page.locator('#galHead')).toHaveText('LM01 Snout tip on 3 specimens');
});

test('a curve is shown whole; unfinished curves say so', async ({ page }, testInfo) => {
  await setUp(page, testInfo);
  await page.keyboard.press('[');
  await page.keyboard.press('[');   // FISH_01
  await clickImage(page, [200, 150]);   // LM02
  await clickImage(page, [350, 100]);   // LM03
  await row(page, 'C01').click();
  await clickImage(page, [220, 80]);
  await page.keyboard.press('g');
  await expect(page.locator('#galHead')).toHaveText('C01 Back on 3 specimens');
  await expect(tile(page, 0)).toHaveAttribute('data-state', 'placed');
  const [x, y, w] = await boxOf(page, 0);
  expect(x).toBeLessThan(100); expect(x + w).toBeGreaterThan(350);   // spans LM01 to LM03
  await expect(tile(page, 1)).toContainText('not placed yet');
});

test('the compare view explains what it needs', async ({ page }, testInfo) => {
  await openApp(page);
  await page.keyboard.press('g');
  await expect(page.locator('#gallery')).toContainText('Open more images to compare LM05');
  await page.keyboard.press('g');
  const imgs = [1, 2].map(i => pngFile(testInfo, `F${i}.png`, 200, 150, i));
  await page.locator('#fImg').setInputFiles(imgs.map(x => x.path));
  await page.keyboard.press('g');
  await expect(page.locator('#gallery')).toContainText('Select a landmark or curve');
});

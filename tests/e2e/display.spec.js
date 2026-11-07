'use strict';
// Display settings: landmark colour, label colour and label size (Specimen tab → Display).
const { test, expect } = require('@playwright/test');
const { openTab, openApp, imgToPage, getState } = require('./helpers.js');

const display = page => page.evaluate(() => ({ ...window.__lmk.display }));

/** The canvas colour at the centre of a placed landmark (its centre dot is drawn in the landmark colour). */
async function centreColour(page, id) {
  const pos = (await getState(page)).landmarks.find(e => e.id === id).position;
  const [px, py] = await imgToPage(page, pos);
  return page.evaluate(([px, py]) => {
    const cv = document.querySelector('#cv'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const d = cv.getContext('2d').getImageData(Math.round((px - r.left) * k), Math.round((py - r.top) * k), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [px, py]);
}
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('the defaults: amber landmarks, labels the same colour, 11 px labels', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  expect(await display(page)).toEqual({ lmColor: '#FFC23D', labelColor: null, labelSize: 11 });
  await expect(page.locator('#lmSwatches .swatch[aria-pressed="true"]')).toHaveAttribute('aria-label', 'Amber');
  await expect(page.locator('#setLabelSame')).toBeChecked();
  await expect(page.locator('#labelSwatches')).toBeHidden();
  await expect(page.locator('#setLabelSizeOut')).toHaveText('11 px');
  expect(near(await centreColour(page, 'LM01'), hexRgb('#FFC23D'))).toBe(true);
});

test('a swatch recolours the landmarks straight away', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  await page.locator('#lmSwatches .swatch[aria-label="Cyan"]').click();
  expect((await display(page)).lmColor).toBe('#22D3EE');
  await expect(page.locator('#lmSwatches .swatch[aria-label="Cyan"]')).toHaveAttribute('aria-pressed', 'true');
  expect(near(await centreColour(page, 'LM01'), hexRgb('#22D3EE'))).toBe(true);
});

test('any colour can be picked, labels can have their own colour, and the size changes', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  await page.locator('#setLmColor').fill('#123456');
  expect((await display(page)).lmColor).toBe('#123456');
  expect(near(await centreColour(page, 'LM01'), hexRgb('#123456'))).toBe(true);

  await page.locator('#setLabelSame').uncheck();
  await expect(page.locator('#labelSwatches')).toBeVisible();
  await page.locator('#labelSwatches .swatch[aria-label="White"]').click();
  expect((await display(page)).labelColor).toBe('#FFFFFF');
  expect((await display(page)).lmColor).toBe('#123456');

  await page.locator('#setLabelSize').fill('18');
  await expect(page.locator('#setLabelSizeOut')).toHaveText('18 px');
  expect((await display(page)).labelSize).toBe(18);

  await page.locator('#setLabelSame').check();
  expect((await display(page)).labelColor).toBeNull();
});

test('settings are kept after a reload, and Reset to defaults restores them', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  await page.locator('#lmSwatches .swatch[aria-label="Violet"]').click();
  await page.locator('#setLabelSize').fill('20');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  expect(await display(page)).toEqual({ lmColor: '#A855F7', labelColor: null, labelSize: 20 });
  await openTab(page, 'Specimen');
  await expect(page.locator('#setLabelSizeOut')).toHaveText('20 px');
  await page.locator('[data-act="display-reset"]').click();
  expect(await display(page)).toEqual({ lmColor: '#FFC23D', labelColor: null, labelSize: 11 });
  expect(near(await centreColour(page, 'LM01'), hexRgb('#FFC23D'))).toBe(true);
});

test('the selected landmark stays pink whatever colour is chosen', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  await page.locator('#lmSwatches .swatch[aria-label="Lime"]').click();
  await openTab(page, 'Landmarks');
  await page.locator('.row[data-id="LM02"]').click();
  expect(near(await centreColour(page, 'LM02'), hexRgb('#FF4FB0'))).toBe(true);
  expect(near(await centreColour(page, 'LM01'), hexRgb('#A3E635'))).toBe(true);
});

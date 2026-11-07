'use strict';
const { expect } = require('@playwright/test');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { makePng } = require('../fixtures/png.js');

/** Open the app and wait until the sample specimen is drawn. Fails on any page error. */
async function openApp(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Web fonts are optional (the app has fallback fonts), so failures to reach the font host are ignored.
  const isFont = m => /fonts\.(googleapis|gstatic)\.com/.test(`${m.text()} ${m.location().url || ''}`);
  page.on('console', m => { if (m.type() === 'error' && !isFont(m)) errors.push(`${m.text()} ${m.location().url || ''}`.trim()); });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  return errors;
}

/** Page coordinates of an image-pixel position, using the app's current view. */
async function imgToPage(page, p) {
  return page.evaluate(([x, y]) => {
    const { S } = window.__lmk;
    const r = document.querySelector('#cv').getBoundingClientRect();
    return [r.left + x * S.view.s + S.view.ox, r.top + y * S.view.s + S.view.oy];
  }, p);
}
async function clickImage(page, p) {
  const [x, y] = await imgToPage(page, p);
  await page.mouse.click(x, y);
}
/** Current view scale (screen px per image px); a click is accurate to about 1/scale. */
const viewScale = page => page.evaluate(() => window.__lmk.S.view.s);

/** A plain copy of the document state. */
async function getState(page) {
  return page.evaluate(() => {
    const { S } = window.__lmk;
    return JSON.parse(JSON.stringify({
      specimen: S.specimen, template: S.template, landmarks: S.landmarks,
      curves: S.curves.map(c => { const o = { ...c }; delete o._geom; return o; }),
      sel: S.sel, warn: S.warn, isSample: S.isSample, hasImage: !!S.img,
    }));
  });
}

/** Click a button and return the downloaded file's name and text. */
async function download(page, locator) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(locator).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: fs.readFileSync(path, 'utf8') };
}

/** Click a button and return the downloaded file's name and bytes. */
async function downloadBytes(page, locator) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(locator).click()]);
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync(await dl.path())) };
}

/** Write a test PNG into the test's output folder; returns its path and sha256. */
function pngFile(testInfo, name, w, h, seed = 0) {
  const buf = makePng(w, h, seed);
  const path = testInfo.outputPath(name);
  fs.writeFileSync(path, buf);
  return { path, sha256: crypto.createHash('sha256').update(buf).digest('hex'), width: w, height: h };
}

/** Switch the side panel to a tab: 'Landmarks', 'Template' or 'Specimen'. */
const openTab = (page, name) => page.getByRole('tab', { name }).click();

/** Replace the template through Template → Edit as text, then go back to the Landmarks tab. */
async function setTemplate(page, text) {
  await openTab(page, 'Template');
  await page.locator('[data-act="tpl-text"]').click();
  await page.locator('#tplText').fill(text);
  await page.getByRole('button', { name: 'Apply template' }).click();
  await openTab(page, 'Landmarks');
}

const row = (page, id) => page.locator(`.row[data-id="${id}"]`);

module.exports = { downloadBytes, openTab, openApp, imgToPage, clickImage, viewScale, getState, download, pngFile, setTemplate, row };

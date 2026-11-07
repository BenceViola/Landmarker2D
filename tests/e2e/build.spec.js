'use strict';
// The single-file build must work when opened straight from disk (file://), with no server.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const built = path.join(__dirname, '..', '..', 'dist', 'landmarker2d.html');

test('dist/landmarker2d.html opens from disk and works', async ({ page }) => {
  test.skip(!fs.existsSync(built), 'run `npm run build` first');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(built).href);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('#tplCount')).toHaveText('5 of 7 done');
  await page.keyboard.press('m');
  await expect(page.locator('.row[data-id="LM05"]')).toHaveAttribute('data-state', 'missing');
  expect(errors).toEqual([]);
});

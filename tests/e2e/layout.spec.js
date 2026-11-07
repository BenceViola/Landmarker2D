'use strict';
// Layout and theming checks.
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers.js');

test('phone width: no sideways scrolling and the image stage stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.locator('#stage').boundingBox();
  expect(box.height).toBeGreaterThan(300);
  await expect(page.locator('#list')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test(`${scheme} theme sets its own page background`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (scheme === 'dark') expect(lum).toBeLessThan(0.2); else expect(lum).toBeGreaterThan(0.8);
  });
}

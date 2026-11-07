'use strict';
// Placing, editing and calibrating on the built-in sample specimen.
const { test, expect } = require('@playwright/test');
const { openTab, openApp, clickImage, imgToPage, viewScale, getState, setTemplate, row } = require('./helpers.js');

test('the sample opens with progress, selection and no errors', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#tplCount')).toHaveText('5 of 7 done');
  await expect(page.locator('#sampleTag')).toBeVisible();
  await expect(row(page, 'LM05')).toHaveClass(/sel/);
  await expect(page.locator('#hint')).toContainText('Click to place LM05');
  await expect(page.locator('#scaleBox')).toContainText('0.025 mm/px');
  const st = await getState(page);
  expect(st.curves[0].points).toHaveLength(10);
  expect(errors).toEqual([]);
});

test('a click places the selected landmark at the clicked pixel and moves on', async ({ page }) => {
  await openApp(page);
  const target = [820.5, 846.5];
  await clickImage(page, target);
  const tol = 1 / (await viewScale(page));
  const lm = (await getState(page)).landmarks.find(e => e.id === 'LM05');
  expect(lm.status).toBe('placed');
  expect(Math.abs(lm.position[0] - target[0])).toBeLessThanOrEqual(tol);
  expect(Math.abs(lm.position[1] - target[1])).toBeLessThanOrEqual(tol);
  await expect(page.locator('#tplCount')).toHaveText('6 of 7 done');
  await expect(row(page, 'C02')).toHaveClass(/sel/);
  await expect(row(page, 'LM05')).toHaveAttribute('data-state', 'placed');
});

test('clicking along a curve produces equally spaced semilandmarks between its anchors', async ({ page }) => {
  await openApp(page);
  await row(page, 'C02').click();
  for (const p of [[520, 720], [760, 790], [1000, 750], [1250, 640]]) await clickImage(page, p);
  const st = await getState(page);
  const c = st.curves.find(x => x.id === 'C02');
  expect(c.control_points).toHaveLength(4);
  expect(c.points).toHaveLength(10);
  expect(c.sampling).toEqual({ path: 'spline', spacing: 'equal_arc_length', n_points: 10 });
  await expect(row(page, 'C02')).toHaveAttribute('data-state', 'placed');
  await expect(row(page, 'C02')).toContainText('10 pts');
  // Backspace removes the last clicked point
  await page.keyboard.press('Backspace');
  expect((await getState(page)).curves.find(x => x.id === 'C02').control_points).toHaveLength(3);
});

test('dragging a landmark moves it, and undo puts it back', async ({ page }) => {
  await openApp(page);
  const before = (await getState(page)).landmarks.find(e => e.id === 'LM01').position;
  const [x, y] = await imgToPage(page, before);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 20, { steps: 5 });
  await page.mouse.up();
  const moved = (await getState(page)).landmarks.find(e => e.id === 'LM01').position;
  const s = await viewScale(page);
  expect(moved[0] - before[0]).toBeCloseTo(30 / s, 0);
  expect(moved[1] - before[1]).toBeCloseTo(20 / s, 0);
  await expect(row(page, 'LM01')).toHaveClass(/sel/);
  await page.keyboard.press('Control+z');
  expect((await getState(page)).landmarks.find(e => e.id === 'LM01').position).toEqual(before);
});

test('dragging empty space pans the view without placing anything', async ({ page }) => {
  await openApp(page);
  const v0 = await page.evaluate(() => ({ ...window.__lmk.S.view }));
  const [x, y] = await imgToPage(page, [900, 950]);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 80, y + 40, { steps: 6 }); await page.mouse.up();
  const v1 = await page.evaluate(() => ({ ...window.__lmk.S.view }));
  expect(v1.ox - v0.ox).toBeCloseTo(80, 0);
  expect(v1.oy - v0.oy).toBeCloseTo(40, 0);
  expect((await getState(page)).landmarks.find(e => e.id === 'LM05')).toBeUndefined();
});

test('the mouse wheel zooms around the cursor', async ({ page }) => {
  await openApp(page);
  // the browser reports whole-pixel mouse positions, so anchor on one
  const [x, y] = (await imgToPage(page, [700, 500])).map(Math.round);
  const anchor = await page.evaluate(([px, py]) => {
    const { S } = window.__lmk, r = document.querySelector('#cv').getBoundingClientRect();
    return [(px - r.left - S.view.ox) / S.view.s, (py - r.top - S.view.oy) / S.view.s];
  }, [x, y]);
  const s0 = await viewScale(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => viewScale(page)).toBeGreaterThan(s0 * 1.5);
  const [x2, y2] = await imgToPage(page, anchor);
  expect(x2).toBeCloseTo(x, 0);
  expect(y2).toBeCloseTo(y, 0);
});

test('keyboard: M marks missing, E marks estimated, Delete clears, Ctrl+Z undoes', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('m');
  await expect(row(page, 'LM05')).toHaveAttribute('data-state', 'missing');
  await page.keyboard.press('Control+z');
  await expect(row(page, 'LM05')).toHaveAttribute('data-state', 'todo');
  await row(page, 'LM03').click();
  await page.keyboard.press('e');
  await expect(row(page, 'LM03')).toHaveAttribute('data-state', 'estimated');
  await page.keyboard.press('Delete');
  await expect(row(page, 'LM03')).toHaveAttribute('data-state', 'todo');
  // C01 is anchored on LM03, so it now reports the missing anchor
  await row(page, 'C01').click();
  await expect(page.locator('#detail')).toContainText('Place LM03 first');
});

test('N jumps to the next unfinished item', async ({ page }) => {
  await openApp(page);
  await row(page, 'LM01').click();
  await page.keyboard.press('n');
  await expect(row(page, 'LM05')).toHaveClass(/sel/);
  await page.keyboard.press('n');
  await expect(row(page, 'C02')).toHaveClass(/sel/);
});

test('measuring a scale bar sets units per pixel', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  await page.locator('[data-act="scale-remove"]').click();
  await expect(page.locator('#scaleBox')).toContainText('Uncalibrated');
  await page.locator('[data-act="scale-start"]').click();
  await clickImage(page, [100, 1050]);
  await clickImage(page, [300, 1050]);
  await page.locator('#barLen').fill('5');
  await page.locator('#barUnits').selectOption('mm');
  await page.locator('[data-act="scale-apply"]').click();
  const sc = (await getState(page)).specimen.image.scale;
  expect(sc.method).toBe('scale_bar');
  expect(sc.bar.length).toBe(5);
  expect(sc.value).toBeCloseTo(0.025, 3);
  await expect(page.locator('#scaleBox')).toContainText('mm/px');
});

test('entering a scale value directly', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Specimen');
  await page.locator('[data-act="scale-manual"]').click();
  await page.locator('#manVal').fill('0.0125');
  await page.locator('#manUnits').selectOption('mm');
  await page.locator('#manMethod').selectOption('calibration');
  await page.locator('[data-act="scale-manual-apply"]').click();
  expect((await getState(page)).specimen.image.scale).toEqual({ value: 0.0125, units: 'mm', method: 'calibration' });
});

test('ad hoc points are placed, labelled and listed separately', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-act="adhoc"]').click();
  await clickImage(page, [1000, 300]);
  await expect(row(page, 'AH01')).toBeVisible();
  await expect(page.locator('.grouph', { hasText: 'Not in template' })).toBeVisible();
  await page.locator('#adLabel').fill('Leaf spot');
  await page.locator('#adLabel').press('Enter');
  await page.locator('#adLabel').blur();
  await expect(row(page, 'AH01')).toContainText('Leaf spot');
});

test('editing the template as text applies it and reports mistakes', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Template');
  await page.locator('[data-act="tpl-text"]').click();
  await expect(page.locator('#tplText')).toHaveValue(/LM01 \| Petiole base/);
  await page.locator('#tplText').fill('LM01 | A\nLM01 | B');
  await page.getByRole('button', { name: 'Apply template' }).click();
  await expect(page.locator('#tplErr')).toContainText('used twice');
  await page.locator('#tplCancel').click();

  await setTemplate(page, '# id: tiny\n# name: Tiny\n# version: 2\nLM01 | Petiole base\nLM09 | New point');
  await expect(page.locator('#tplName')).toContainText('Tiny');
  await expect(row(page, 'LM09')).toBeVisible();
  // LM02-LM04 are no longer in the template: they become ad hoc points
  await expect(page.locator('.grouph', { hasText: 'Not in template' })).toBeVisible();
  await expect(row(page, 'LM02')).toBeVisible();
  const st = await getState(page);
  expect(st.curves).toEqual([]);
  expect(st.landmarks.find(e => e.id === 'LM02').template_id).toBeNull();
});

test('the loupe stays on while a landmark is dragged, centred on the landmark', async ({ page }) => {
  await openApp(page);
  const loupe = () => page.evaluate(() => window.__lmk.loupe);
  const start = (await getState(page)).landmarks.find(e => e.id === 'LM02').position;
  const [x, y] = await imgToPage(page, start);
  await page.mouse.move(x + 2, y + 1);   // grab it slightly off-centre
  expect(await loupe()).not.toBeNull();
  await page.mouse.down();
  await page.mouse.move(x + 22, y + 11, { steps: 4 });
  const during = await loupe();
  expect(during.dragging).toBe(true);
  const now = (await getState(page)).landmarks.find(e => e.id === 'LM02').position;
  expect(during.center[0]).toBeCloseTo(now[0], 3);
  expect(during.center[1]).toBeCloseTo(now[1], 3);
  await page.mouse.up();
  expect((await loupe()).dragging).toBe(false);
});

test('panning hides the loupe', async ({ page }) => {
  await openApp(page);
  const [x, y] = await imgToPage(page, [900, 950]);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 40, y + 20, { steps: 4 });
  expect(await page.evaluate(() => window.__lmk.loupe)).toBeNull();
  await page.mouse.up();
});

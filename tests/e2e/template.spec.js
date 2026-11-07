'use strict';
// The Template tab, which works like the one in Landmarker3D.
const { test, expect } = require('@playwright/test');
const { openTab, openApp, clickImage, getState, row } = require('./helpers.js');

const item = (page, kind, id) => page.locator(`.tpl-item[data-kind="${kind}"][data-row="${id}"]`);
const lmIds = async page => (await getState(page)).template.landmarks.map(d => d.id);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openTab(page, 'Template');
});

test('the tab shows the template details, landmarks and curves', async ({ page }) => {
  await expect(page.locator('#tpl-f-name')).toHaveValue('Leaf outline, basic set');
  await expect(page.locator('#tpl-f-id')).toHaveValue('leaf-basic');
  await expect(page.locator('#tpl-f-version')).toHaveValue('1.0');
  await expect(page.locator('#tpl-lm-list > li')).toHaveCount(5);
  await expect(page.locator('#tpl-curve-list > li')).toHaveCount(2);
  await expect(item(page, 'lm', 'LM04').locator('summary')).toContainText('pair LM05');
  await expect(item(page, 'curve', 'C01').locator('summary')).toContainText('10 points · LM02 → LM03 · smooth');
  // the landmark being placed (LM05) is marked
  await expect(item(page, 'lm', 'LM05')).toHaveClass(/is-active/);
});

test('"Edit template" on the Landmarks tab opens this tab; arrow keys move between tabs', async ({ page }) => {
  await openTab(page, 'Landmarks');
  await page.locator('[data-act="goto-template"]').click();
  await expect(page.getByRole('tab', { name: 'Template' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-landmarks')).toBeHidden();
  await page.getByRole('tab', { name: 'Template' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Specimen' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#spId')).toBeVisible();
});

test('adding landmarks one at a time (Enter) and several at once', async ({ page }) => {
  await page.locator('#tpl-new-name').fill('Midrib tip');
  await page.locator('#tpl-new-name').press('Enter');
  await expect(item(page, 'lm', 'LM06').locator('.tpl-name')).toHaveValue('Midrib tip');
  await expect(page.locator('#tpl-new-name')).toBeFocused();
  await expect(page.locator('#tpl-new-name')).toHaveValue('');
  // an empty name adds nothing
  await page.locator('[data-act="add"]').click();
  expect(await lmIds(page)).toHaveLength(6);

  await page.locator('#tpl-bulk-box summary').click();
  await page.locator('#tpl-bulk').fill('Vein 1\n\nVein 2\n');
  await page.locator('[data-act="add-bulk"]').click();
  expect(await lmIds(page)).toEqual(['LM01', 'LM02', 'LM03', 'LM04', 'LM05', 'LM06', 'LM07', 'LM08']);
  await openTab(page, 'Landmarks');
  await expect(row(page, 'LM08')).toContainText('Vein 2');
  await expect(page.locator('#tplCount')).toHaveText('5 of 10 done');
});

test('renaming a landmark updates the list, and undo puts it back', async ({ page }) => {
  const name = item(page, 'lm', 'LM03').locator('.tpl-name');
  await name.fill('Leaf apex');
  await name.press('Tab');
  await expect(item(page, 'lm', 'LM03').locator('.tpl-name')).toHaveValue('Leaf apex');
  await openTab(page, 'Landmarks');
  await expect(row(page, 'LM03')).toContainText('Leaf apex');
  await page.keyboard.press('Control+z');
  await expect(row(page, 'LM03')).toContainText('Apex');
  await expect(row(page, 'LM03')).not.toContainText('Leaf apex');
});

test('IDs are locked once a landmark has data; bad IDs are explained', async ({ page }) => {
  await expect(item(page, 'lm', 'LM01').locator('.tpl-id')).toHaveAttribute('readonly', '');
  const id5 = item(page, 'lm', 'LM05').locator('.tpl-id');
  await expect(id5).not.toHaveAttribute('readonly', '');
  await id5.fill('wide low');
  await id5.press('Enter');
  await expect(item(page, 'lm', 'LM05').locator('.tpl-err')).toContainText('letters, digits');
  await expect(item(page, 'lm', 'LM05').locator('.tpl-id')).toHaveValue('LM05');
  await item(page, 'lm', 'LM05').locator('.tpl-id').fill('LM02');
  await item(page, 'lm', 'LM05').locator('.tpl-id').press('Enter');
  await expect(item(page, 'lm', 'LM05').locator('.tpl-err')).toContainText('LM02 is already used');

  await item(page, 'lm', 'LM05').locator('.tpl-id').fill('WID_LOW');
  await item(page, 'lm', 'LM05').locator('.tpl-id').press('Enter');
  await expect(item(page, 'lm', 'WID_LOW')).toBeVisible();
  await expect(item(page, 'lm', 'WID_LOW').locator('.tpl-err')).toHaveCount(0);
  const st = await getState(page);
  expect(st.template.landmarks.find(d => d.id === 'LM04').bilateral_pair).toBe('WID_LOW');
  expect(st.sel).toEqual({ kind: 'lm', id: 'WID_LOW' }, 'the renamed landmark stays selected');
});

test('placement instructions and bilateral pairs', async ({ page }) => {
  const lm1 = item(page, 'lm', 'LM01');
  await lm1.locator('summary').click();
  await lm1.locator('textarea').fill('Cut end of the petiole');
  await lm1.locator('textarea').blur();
  await expect(item(page, 'lm', 'LM01').locator('summary')).toContainText('Cut end of the petiole');
  // the details stay open after the re-render
  await expect(item(page, 'lm', 'LM01').locator('details')).toHaveAttribute('open', '');

  await item(page, 'lm', 'LM01').locator('select').selectOption('LM04');
  const t = (await getState(page)).template.landmarks;
  const pair = id => t.find(d => d.id === id).bilateral_pair;
  expect(pair('LM01')).toBe('LM04');
  expect(pair('LM04')).toBe('LM01');
  expect(pair('LM05')).toBeUndefined();
  await openTab(page, 'Landmarks');
  await row(page, 'LM01').click();
  await expect(page.locator('#detail')).toContainText('Cut end of the petiole');
  await expect(page.locator('#detail')).toContainText('Bilateral pair: LM04');
});

test('moving landmarks changes the placing and export order', async ({ page }) => {
  await expect(item(page, 'lm', 'LM01').locator('[data-act="up"]')).toBeDisabled();
  await expect(item(page, 'lm', 'LM05').locator('[data-act="down"]')).toBeDisabled();
  await item(page, 'lm', 'LM05').locator('[data-act="up"]').click();
  await item(page, 'lm', 'LM05').locator('[data-act="up"]').click();
  expect(await lmIds(page)).toEqual(['LM01', 'LM02', 'LM05', 'LM03', 'LM04']);
  await expect(page.locator('#tpl-lm-list > li').nth(2)).toHaveAttribute('data-row', 'LM05');
  const order = await page.evaluate(() => window.__lmk.C.exportRows(window.__lmk.S).map(r => r.point).slice(0, 5));
  expect(order).toEqual(['LM01', 'LM02', 'LM05', 'LM03', 'LM04']);
});

test('deleting asks first, mentions placed points, and can be undone', async ({ page }) => {
  await item(page, 'lm', 'LM04').locator('[data-act="del"]').click();
  await expect(item(page, 'lm', 'LM04').locator('.tpl-confirm')).toContainText('Delete LM04 Widest point, upper and its placed point?');
  await item(page, 'lm', 'LM04').getByRole('button', { name: 'Cancel' }).click();
  await expect(item(page, 'lm', 'LM04').locator('.tpl-confirm')).toHaveCount(0);

  await item(page, 'lm', 'LM04').locator('[data-act="del"]').click();
  await item(page, 'lm', 'LM04').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(item(page, 'lm', 'LM04')).toHaveCount(0);
  let st = await getState(page);
  expect(st.landmarks.find(e => e.id === 'LM04')).toBeUndefined();
  expect(st.template.landmarks.find(d => d.id === 'LM05').bilateral_pair).toBeUndefined();

  await page.locator('#tpl-f-name').focus();
  await page.locator('#tpl-f-name').blur();
  await page.keyboard.press('Control+z');
  await expect(item(page, 'lm', 'LM04')).toBeVisible();
  st = await getState(page);
  expect(st.landmarks.find(e => e.id === 'LM04').status).toBe('placed');
});

test('deleting a landmark that a curve starts on frees that end of the curve', async ({ page }) => {
  await item(page, 'lm', 'LM02').locator('[data-act="del"]').click();
  await item(page, 'lm', 'LM02').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(item(page, 'curve', 'C01').locator('summary')).toContainText('free → LM03');
});

test('adding and setting up a curve, then tracing it', async ({ page }) => {
  await page.locator('#tpl-new-curve').fill('Midrib');
  await page.locator('#tpl-new-curve').press('Enter');
  const c = item(page, 'curve', 'C03');
  await expect(c.locator('details')).toHaveAttribute('open', '');
  await c.locator('[data-edit="start"]').selectOption('LM02');
  await c.locator('[data-edit="end"]').selectOption('LM03');
  await c.locator('[data-edit="n_points"]').fill('5');
  await c.locator('[data-edit="n_points"]').press('Enter');
  await c.locator('[data-edit="path"]').selectOption('spline');
  await expect(c.locator('summary')).toContainText('5 points · LM02 → LM03 · smooth');
  expect((await getState(page)).template.curves[2]).toEqual(
    { id: 'C03', name: 'Midrib', n_points: 5, path: 'spline', spacing: 'equal_arc_length', start: 'LM02', end: 'LM03' });

  await openTab(page, 'Landmarks');
  await row(page, 'C03').click();
  await clickImage(page, [800, 545]);
  await clickImage(page, [1100, 545]);
  expect((await getState(page)).curves.find(x => x.id === 'C03').points).toHaveLength(5);

  // changing the number of points resamples the traced curve; its ID is now locked (details stay open)
  await openTab(page, 'Template');
  await expect(item(page, 'curve', 'C03').locator('.tpl-id')).toHaveAttribute('readonly', '');
  const n = item(page, 'curve', 'C03').locator('[data-edit="n_points"]');
  await n.fill('8');
  await n.press('Enter');
  expect((await getState(page)).curves.find(x => x.id === 'C03').points).toHaveLength(8);
});

test('curve settings that make no sense are explained and not applied', async ({ page }) => {
  const c = item(page, 'curve', 'C02');
  await c.locator('summary').click();
  await c.locator('[data-edit="n_points"]').fill('0');
  await c.locator('[data-edit="n_points"]').press('Enter');
  await expect(item(page, 'curve', 'C02').locator('.tpl-err')).toContainText('whole number from 1');
  expect((await getState(page)).template.curves[1].n_points).toBe(10);
  await item(page, 'curve', 'C02').locator('[data-edit="start"]').selectOption('LM03');
  await expect(item(page, 'curve', 'C02').locator('.tpl-err')).toContainText('same landmark');
  expect((await getState(page)).template.curves[1].start).toBe('LM02');
});

test('a closed loop has no start or end', async ({ page }) => {
  const c = item(page, 'curve', 'C02');
  await c.locator('summary').click();
  await c.locator('[data-edit="closed"]').check();
  await expect(item(page, 'curve', 'C02').locator('[data-edit="start"]')).toBeDisabled();
  await expect(item(page, 'curve', 'C02').locator('summary')).toContainText('closed loop');
  const t = (await getState(page)).template.curves[1];
  expect(t.closed).toBe(true);
  expect(t.start).toBeUndefined();
});

test('template name and ID; a bad ID is refused', async ({ page }) => {
  await page.locator('#tpl-f-name').fill('Leaf, lab protocol');
  await page.locator('#tpl-f-name').press('Tab');
  await expect(page.locator('#tpl-f-id')).toBeFocused();
  await page.locator('#tpl-f-id').fill('leaf lab');
  await page.locator('#tpl-f-id').press('Enter');
  await expect(page.locator('.tpl-meta .tpl-err')).toContainText('letters, digits');
  await expect(page.locator('#tpl-f-id')).toHaveValue('leaf-basic');
  await openTab(page, 'Landmarks');
  await expect(page.locator('#tplName')).toContainText('Leaf, lab protocol');
});

test('starting a new empty template asks first and can be undone', async ({ page }) => {
  await page.locator('[data-act="new"]').click();
  await expect(page.locator('.tpl-danger')).toContainText('removes all 5 landmarks and 2 curves');
  await page.locator('[data-act="new-yes"]').click();
  await expect(page.locator('#tpl-lm-list')).toHaveCount(0);
  await expect(page.locator('#tpl-f-name')).toHaveValue('Untitled template');
  expect((await getState(page)).landmarks).toEqual([]);
  await openTab(page, 'Landmarks');
  await expect(page.locator('#list')).toContainText('The template is empty');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#tplCount')).toHaveText('5 of 7 done');
});

test('typing in a template field does not trigger the placing shortcuts', async ({ page }) => {
  await page.locator('#tpl-new-name').fill('mne');
  await page.locator('#tpl-new-name').press('m');
  const st = await getState(page);
  expect(st.landmarks.find(e => e.id === 'LM05')).toBeUndefined();
});

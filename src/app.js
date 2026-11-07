/*
 * landmarker2D UI: canvas, pointer handling, side panel, file I/O.
 * All format logic lives in core.js (window.LmkCore).
 */
(() => {
'use strict';
const C = window.LmkCore;
const $ = s => document.querySelector(s);
const COL = { lm:'#FFC23D', sel:'#FF4FB0', adhoc:'#FFFFFF', curve:'#46D2FF', bar:'#FFFFFF' };

const stage = $('#stage'), cv = $('#cv'), ctx = cv.getContext('2d');
let dpr = 1;

// The specimen set: one shared template and one record per specimen (its image,
// landmarks, scale and view). `S` is what the rest of the UI works on: its
// document fields read and write the current specimen, `template` is the set's.
const set = C.newSet();
let cur = null;
const S = { sel:null, tool:'place', scaleDraft:[], scaleManual:false, labels:true, loupe:true,
  hover:null, hoverScr:null, pointerType:'mouse' };
for (const k of ['raw', 'specimen', 'landmarks', 'curves', 'provenance', 'img', 'imgSha', 'view', 'isSample', 'warn', 'order'])
  Object.defineProperty(S, k, { get: () => cur[k], set: v => { cur[k] = v; }, enumerable: true });
Object.defineProperty(S, 'template', { get: () => set.template, set: v => { set.template = v; }, enumerable: true });
Object.defineProperty(S, '_set', { get: () => set });
window.__lmk = { S, C, set, get cur(){ return cur; }, get loupe(){ return lastLoupe; } };   // used by the end-to-end tests

/** A specimen's name for the UI: its ID, plus "r2" etc. once it has replicates. */
function labelOf(r){
  const n = C.replicateOf(r);
  return n > 1 || set.specimens.some(x => x !== r && C.sameSpecimen(x, r)) ? `${r.specimen.id} r${n}` : r.specimen.id;
}
let uidN = 0;
function newRecord(fields){
  const rec = Object.assign({ raw:{}, specimen:{ id:'', image:{ file:'', sha256:'', width:0, height:0 } },
    landmarks:[], curves:[], provenance:{}, img:null, imgSha:null, view:null, isSample:false, warn:null, thumb:null, order:null, uid:++uidN }, fields);
  return C.joinSet(set, rec);
}
/** Empty the set (keeping no specimen) and start from a template. */
function resetSet(template){
  set.specimens.splice(0);
  set.template = template || C.emptyTemplate();
  undoStack.length = 0;
}
const templateIsBlank = () => !(set.template.landmarks || []).length && !(set.template.curves || []).length;
const hasData = r => r.landmarks.length > 0 || r.curves.length > 0;
/** Show another specimen. */
function switchTo(rec, keepSel){
  if (!rec) return;
  S.tool = 'place'; S.scaleDraft = []; S.scaleManual = false; removing = false;
  cur = rec; S.hover = null;
  if (!cur.view){ cur.view = { s:1, ox:0, oy:0 }; fit(); }
  // start each specimen at its first unfinished item (Landmark 1 on a new one);
  // nothing is selected on a finished specimen, so a stray click can't move a point
  if (!keepSel) S.sel = C.nextTodo(S, null, S.order);
  setFields(); C.recomputeCurves(S); renderSide(); draw();
}
function stepSpecimen(d){
  const j = set.specimens.indexOf(cur) + d;
  if (j < 0) toast('This is the first specimen');
  else if (j >= set.specimens.length) toast('This is the last specimen');
  else switchTo(set.specimens[j]);
}
let removing = false;
function removeCurrent(){
  if (set.specimens.length < 2) return;
  const i = set.specimens.indexOf(cur);
  set.specimens.splice(i, 1);
  undoStack.length = 0;
  toast(`Removed ${labelOf(cur)} from the set. Its work stays saved in this browser.`);
  switchTo(set.specimens[Math.min(i, set.specimens.length - 1)]);
}

// The Template tab (src/template-editor.js)
const tplEditor = new window.LmkTemplateEditor($('#tplEditor'), {
  S, C,
  mutate: fn => mutate(fn),
  afterAdd: (kind, id) => { if (!S.sel || S.sel.kind === 'adhoc') { S.sel = { kind, id }; renderSide(); draw(); } },
  saveTemplate: () => { const t = C.clone(S.template); t.dimensions = 2; saveFile(`${t.id || 'template'}.template.json`, JSON.stringify(t, null, 2) + '\n'); },
  loadTemplate: () => $('#fTpl').click(),
  editAsText: () => { $('#tplText').value = C.tplToText(S.template); $('#tplErr').textContent = ''; $('#dTpl').showModal(); },
});

/* ---------- helpers ---------- */
const { r6, fmt, dist } = C;
const f2 = v => v.toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const tLm = id => C.tLm(S, id);
const tCurve = id => C.tCurve(S, id);
const lmEntry = id => C.lmEntry(S, id);
const curveEntry = id => C.curveEntry(S, id);
const items = () => C.items(S);
const itemState = it => C.itemState(S, it);
const isDone = it => C.isDone(S, it);
const nextTodo = () => C.nextTodo(S, S.sel, S.order);
const adhocEntries = () => C.adhocEntries(S);
const scaleObj = () => C.scaleOf(S);
const imgW = () => S.img ? S.img.width : (S.specimen.image?.width || 0);
const imgH = () => S.img ? S.img.height : (S.specimen.image?.height || 0);
const operator = () => $('#opName').value.trim();

let toastT;
function toast(msg, ms = 3200){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }

/* ---------- undo ---------- */
const undoStack = [];
const snap = () => JSON.stringify({ t:set.template, cur:set.specimens.indexOf(cur),
  r:set.specimens.map(r => ({ l:r.landmarks.map(stripGeom), c:r.curves.map(stripGeom), sc:r.specimen.image?.scale ?? null })) });
function stripGeom(o){ const r = {}; for (const k in o) if (k[0] !== '_') r[k] = o[k]; return r; }
function pushUndo(){ undoStack.push(snap()); if (undoStack.length > 150) undoStack.shift(); }
function undo(){
  const s = undoStack.pop(); if (!s){ toast('Nothing to undo'); return; }
  const o = JSON.parse(s);
  set.template = o.t;
  o.r.forEach((x, i) => {
    const r = set.specimens[i]; if (!r) return;
    r.landmarks = x.l; r.curves = x.c;
    if (x.sc) r.specimen.image.scale = x.sc; else delete r.specimen.image.scale;
  });
  const back = set.specimens[o.cur];
  if (back && back !== cur){ cur = back; setFields(); }   // show the specimen that changed
  changed();
}
function changed(){ fixSel(); for (const r of set.specimens) C.recomputeCurves(r); renderSide(); draw(); autosave(); }
/** Keep the selection pointing at something that still exists. */
function fixSel(){
  if (!S.sel || S.sel.kind === 'adhoc') return;
  const ok = S.sel.kind === 'lm' ? (tLm(S.sel.id) || lmEntry(S.sel.id)) : tCurve(S.sel.id);
  if (!ok) S.sel = C.nextTodo(S, null, S.order);
}
/** Run an edit; if it changed the document, record one undo step and redraw. Returns the edit's result. */
function mutate(fn){
  const before = snap();
  const result = fn();
  if (snap() !== before){ undoStack.push(before); if (undoStack.length > 150) undoStack.shift(); changed(); }
  else tplEditor.requestRender();
  return result;
}

/* ---------- placing ---------- */
function handleClick(p){
  const W = imgW(), H = imgH();
  if (!W) return;
  if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H){ toast('That click is outside the image'); return; }
  if (S.tool === 'scale'){
    S.scaleDraft.push(p);
    if (S.scaleDraft.length >= 2) S.tool = 'scale-form';
    renderSide(); draw(); return;
  }
  if (S.tool === 'scale-form') return;
  if (!S.sel){ toast('Pick a landmark in the list first, or add an ad hoc point'); return; }
  pushUndo();
  if (S.sel.kind === 'adhoc'){
    const e = C.addAdhoc(S, p);
    S.sel = { kind:'lm', id:e.id };
  } else if (S.sel.kind === 'lm'){
    C.placeLm(S, S.sel.id, p);
    // move on to the next landmark, except in the compare view, which stays on the landmark being reviewed
    if (tLm(S.sel.id) && !gal.open){ const nx = nextTodo(); if (nx) S.sel = nx; }
  } else {
    const c = C.ensureCurve(S, S.sel.id);
    if (c.status === 'missing') c.status = 'placed';
    c.control_points.push({ position:[r6(p[0]), r6(p[1])] });
  }
  changed();
}

/* ---------- view ---------- */
const toImg = (sx, sy) => [(sx - S.view.ox) / S.view.s, (sy - S.view.oy) / S.view.s];
const toScr = p => [p[0] * S.view.s + S.view.ox, p[1] * S.view.s + S.view.oy];
function stageSize(){ const r = stage.getBoundingClientRect(); return [r.width, r.height]; }
function fit(){
  const W = imgW(), H = imgH(); if (!W) return;
  const [w, h] = stageSize();
  const s = Math.min(w / W, h / H) * 0.92;
  S.view = { s, ox:(w - W*s)/2, oy:(h - H*s)/2 };
  draw();
}
function zoomAt(f, sx, sy){
  const p = toImg(sx, sy);
  const W = imgW() || 1000; const [w] = stageSize();
  const s = clamp(S.view.s * f, Math.min(0.05, (w / W) * 0.25), 64);
  S.view.s = s; S.view.ox = sx - p[0]*s; S.view.oy = sy - p[1]*s; draw();
}
function resize(){
  const [w, h] = stageSize(); dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
  draw();
}

/* ---------- drawing ---------- */
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function ring(x, y, r, color, dashed){
  ctx.setLineDash([]); ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
  ctx.lineWidth = 1.75; ctx.strokeStyle = color; if (dashed) ctx.setLineDash([3, 2.5]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
}
function label(x, y, text, color){
  ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.fillStyle = color;
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
}
function marker(p, o){
  const [x, y] = toScr(p);
  const color = o.sel ? COL.sel : o.adhoc ? COL.adhoc : COL.lm;
  const r = o.sel ? 8 : 5.5;
  ring(x, y, r, color, o.estimated);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI*2); ctx.fill();
  if (o.sel){
    ctx.strokeStyle = color; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(x - r - 6, y); ctx.lineTo(x - r - 1, y); ctx.moveTo(x + r + 1, y); ctx.lineTo(x + r + 6, y);
    ctx.moveTo(x, y - r - 6); ctx.lineTo(x, y - r - 1); ctx.moveTo(x, y + r + 1); ctx.lineTo(x, y + r + 6); ctx.stroke();
  }
  if (S.labels && o.text) label(x + r + 5, y - r - 2, o.text, color);
}
function drawScaleBar(pts, text){
  const [a, b] = pts.map(toScr);
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
  ctx.lineWidth = 1.75; ctx.strokeStyle = COL.bar; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]);
  for (const p of [a, b]){ ctx.fillStyle = COL.bar; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(p[0]-4, p[1]-4, 8, 8); ctx.stroke(); ctx.fill(); }
  if (text) label((a[0]+b[0])/2 - 18, Math.min(a[1], b[1]) - 10, text, COL.bar);
}
function draw(){
  const w = cv.width / dpr, h = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--stage') || '#252C35'; ctx.fillRect(0, 0, w, h);
  $('#zPct').textContent = Math.round(S.view.s * 100) + '%';
  const W = imgW(), H = imgH();
  if (!W){
    ctx.fillStyle = '#B9C3CF'; ctx.font = '500 14px Archivo, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Open an image (JPG, PNG, WebP) or drop it here', w/2, h/2); ctx.textAlign = 'left';
    updateHint(); return;
  }
  const [x0, y0] = toScr([0, 0]);
  if (S.img){
    ctx.imageSmoothingEnabled = S.view.s < 2;
    ctx.drawImage(S.img, x0, y0, W * S.view.s, H * S.view.s);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x0, y0, W*S.view.s, H*S.view.s);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([6,5]); ctx.strokeRect(x0, y0, W*S.view.s, H*S.view.s); ctx.setLineDash([]);
    ctx.fillStyle = '#D5DDE6'; ctx.font = '500 14px Archivo, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Open ${S.specimen.image.file || 'the image'} to see it here`, x0 + W*S.view.s/2, y0 + H*S.view.s/2); ctx.textAlign = 'left';
  }
  const sc = scaleObj();
  if (sc && sc.bar && sc.bar.points && S.tool === 'place') drawScaleBar(sc.bar.points, `${sc.bar.length} ${sc.units}`);

  for (const c of S.curves){
    const g = c._geom; const t = tCurve(c.template_id); if (!g || !t) continue;
    const isSel = S.sel && S.sel.kind === 'curve' && S.sel.id === c.id;
    if (g.dense.length >= 2){
      ctx.beginPath(); g.dense.forEach((p, i) => { const q = toScr(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); });
      ctx.lineWidth = isSel ? 4.5 : 3.5; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
      ctx.lineWidth = isSel ? 2 : 1.25; ctx.strokeStyle = isSel ? COL.sel : COL.curve; ctx.stroke();
    }
    if (c.status !== 'missing') for (const p of g.pts){
      const [x, y] = toScr(p);
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI*2); ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI*2); ctx.fillStyle = COL.curve; ctx.fill();
    }
    (c.control_points || []).forEach(cp => {
      const [x, y] = toScr(cp.position); const r = isSel ? 4.5 : 3;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeRect(x-r, y-r, 2*r, 2*r);
      ctx.lineWidth = 1.25; ctx.strokeStyle = isSel ? COL.sel : '#FFFFFF'; ctx.strokeRect(x-r, y-r, 2*r, 2*r);
    });
    if (S.labels && g.dense.length >= 2){
      const m = g.dense[Math.floor(g.dense.length/2)], [x, y] = toScr(m);
      label(x + 8, y + 16, c.id, isSel ? COL.sel : COL.curve);
    }
  }
  for (const e of S.landmarks){
    if (!e.position || e.status === 'missing') continue;
    const isSel = S.sel && S.sel.kind === 'lm' && S.sel.id === e.id;
    if (!isSel) marker(e.position, { estimated:e.status === 'estimated', adhoc:!e.template_id || !tLm(e.template_id), text:e.id });
  }
  if (S.sel && S.sel.kind === 'lm'){ const e = lmEntry(S.sel.id); if (e && e.position && e.status !== 'missing') marker(e.position, { sel:true, estimated:e.status === 'estimated', text:e.id }); }
  if (S.tool !== 'place' && S.scaleDraft.length){
    const pts = S.scaleDraft.length === 1 && S.hover ? [S.scaleDraft[0], S.hover] : S.scaleDraft;
    if (pts.length === 2) drawScaleBar(pts, f2(dist(pts[0], pts[1])) + ' px');
    else { const [x, y] = toScr(pts[0]); ctx.fillStyle = COL.bar; ctx.fillRect(x-4, y-4, 8, 8); }
  }
  drawLoupe(w, h);
  updateHint();
}
let lastLoupe = null;   // what the loupe showed last, for the tests
function drawLoupe(w, h){
  lastLoupe = null;
  if (!S.loupe || !S.img || !S.hover || !S.hoverScr || S.pointerType !== 'mouse') return;
  // While a point is dragged the loupe follows the point itself (not the cursor,
  // which may have grabbed it slightly off-centre); other gestures hide it.
  const dragging = gesture && gesture.type === 'drag' && gesture.moved;
  if (gesture && !dragging) return;
  const size = 150, z = Math.max(S.view.s * 3, 4), sw = size / z;
  const [hx, hy] = dragging
    ? [clamp(S.hover[0] - gesture.off[0], 0, imgW()), clamp(S.hover[1] - gesture.off[1], 0, imgH())]
    : S.hover;
  const [sx, sy] = S.hoverScr;
  lastLoupe = { center:[hx, hy], dragging:!!dragging };
  const lx = (sx < size + 40 && sy < size + 40) ? w - size - 12 : 12, ly = 12;
  const left = hx - sw/2, top = hy - sw/2;
  ctx.save();
  ctx.beginPath(); ctx.rect(lx, ly, size, size); ctx.fillStyle = '#000'; ctx.fill(); ctx.clip();
  ctx.imageSmoothingEnabled = false;
  const W = S.img.width, H = S.img.height;
  const cx0 = Math.max(0, left), cy0 = Math.max(0, top), cx1 = Math.min(W, left + sw), cy1 = Math.min(H, top + sw);
  if (cx1 > cx0 && cy1 > cy0) ctx.drawImage(S.img, cx0, cy0, cx1-cx0, cy1-cy0, lx + (cx0-left)*z, ly + (cy0-top)*z, (cx1-cx0)*z, (cy1-cy0)*z);
  const mp = p => [lx + (p[0]-left)*z, ly + (p[1]-top)*z];
  for (const e of S.landmarks){ if (!e.position || e.status === 'missing') continue; const [x, y] = mp(e.position);
    if (x > lx-10 && x < lx+size+10 && y > ly-10 && y < ly+size+10) ring(x, y, 6, S.sel && S.sel.id === e.id ? COL.sel : COL.lm, e.status === 'estimated'); }
  // curve control points and scale-bar ends can be dragged too
  const square = (p, color) => { const [x, y] = mp(p); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeRect(x-4, y-4, 8, 8); ctx.lineWidth = 1.25; ctx.strokeStyle = color; ctx.strokeRect(x-4, y-4, 8, 8); };
  for (const c of S.curves) for (const cp of c.control_points || []) square(cp.position, '#FFFFFF');
  const bar = scaleObj()?.bar?.points;
  if (bar && S.tool === 'place') bar.forEach(p => square(p, COL.bar));
  ctx.strokeStyle = 'rgba(255,79,176,.95)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lx + size/2, ly); ctx.lineTo(lx + size/2, ly + size/2 - 6); ctx.moveTo(lx + size/2, ly + size/2 + 6); ctx.lineTo(lx + size/2, ly + size);
  ctx.moveTo(lx, ly + size/2); ctx.lineTo(lx + size/2 - 6, ly + size/2); ctx.moveTo(lx + size/2 + 6, ly + size/2); ctx.lineTo(lx + size, ly + size/2); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.strokeRect(lx + .5, ly + .5, size - 1, size - 1);
}
function updateHint(){
  const el = $('#hint'); let html = '';
  if (!imgW()) html = 'Open an image to start. Coordinates are stored in raw image pixels.';
  else if (S.tool === 'scale') html = S.scaleDraft.length ? 'Click the <b>second end</b> of the scale bar' : 'Click the <b>first end</b> of the scale bar';
  else if (S.tool === 'scale-form') html = 'Enter the known length in the side panel';
  else if (!S.sel) html = (items().length ? 'All template points are done. Save, or pick one to edit.' : 'Edit or load a template, or add ad hoc points');
  else if (S.sel.kind === 'adhoc') html = 'Click to place an <b>ad hoc point</b>';
  else if (S.sel.kind === 'lm'){
    const t = tLm(S.sel.id), e = lmEntry(S.sel.id);
    const nm = t ? t.name : (e && e.label) || '';
    html = `${e && e.position ? 'Click to move' : 'Click to place'} <b>${esc(S.sel.id)}</b> ${esc(nm)}`;
  } else {
    const t = tCurve(S.sel.id), c = curveEntry(S.sel.id), n = c ? c.control_points.length : 0;
    const anch = t && !t.closed && (t.start || t.end) ? ` · ends snap to ${[t.start, t.end].filter(Boolean).join(' and ')}` : '';
    html = `Click along <b>${esc(S.sel.id)}</b> ${esc(t ? t.name : '')} in order (${n} point${n === 1 ? '' : 's'})${anch}`;
  }
  el.innerHTML = html;
}

/* ---------- side panel ---------- */
function setFields(){
  $('#spId').value = S.specimen.id || '';
  $('#spNotes').value = S.specimen.notes || '';
  if (S.provenance.operator && !$('#opName').value.trim()) $('#opName').value = S.provenance.operator;
}
function unitOpts(u){ return C.UNITS.map(x => `<option value="${x}"${x === u ? ' selected' : ''}>${x === 'um' ? 'µm' : x}</option>`).join(''); }
function renderSide(){
  const ws = $('#warnSec');
  if (S.warn){ ws.hidden = false; ws.innerHTML = `<div class="warnbox" id="warnText"><span>${esc(S.warn)}</span><button class="btn sm" type="button" data-act="dismiss-warn">Dismiss</button></div>`; }
  else { ws.hidden = true; ws.innerHTML = ''; }
  $('#sampleTag').hidden = !S.isSample;

  const im = S.specimen.image || {};
  $('#imgMeta').innerHTML = im.file
    ? `<b>${esc(im.file)}</b><br>${im.width} × ${im.height} px · sha256 ${esc((im.sha256 || '—').slice(0, 12))}${im.sha256 ? '…' : ''}${S.img ? '' : ' · <span style="color:var(--warn)">image not open</span>'}`
    : 'No image open';

  const sb = $('#scaleBox'), sc = scaleObj();
  if (S.tool === 'scale'){
    sb.innerHTML = `<div class="inline"><span>Click the two ends of the scale bar (${S.scaleDraft.length}/2)</span><button class="btn sm" type="button" data-act="scale-cancel">Cancel</button></div>`;
  } else if (S.tool === 'scale-form'){
    const px = dist(S.scaleDraft[0], S.scaleDraft[1]);
    sb.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px"><span>Bar length <span class="val">${f2(px)} px</span>. Known length:</span>
      <div class="inline"><input type="number" id="barLen" min="0" step="any" value="${sc?.bar?.length ?? 10}" style="width:90px">
      <select id="barUnits" style="width:80px">${unitOpts(sc?.units || 'mm')}</select>
      <button class="btn sm primary" type="button" data-act="scale-apply">Set scale</button><button class="btn sm" type="button" data-act="scale-cancel">Cancel</button></div></div>`;
  } else if (S.scaleManual){
    sb.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px"><span>Units per pixel:</span>
      <div class="inline"><input type="number" id="manVal" min="0" step="any" value="${sc?.value ?? ''}" style="width:110px">
      <select id="manUnits" style="width:80px">${unitOpts(sc?.units || 'mm')}</select>
      <select id="manMethod" style="width:120px"><option value="calibration">calibration</option><option value="manual">manual</option></select>
      <button class="btn sm primary" type="button" data-act="scale-manual-apply">Set</button><button class="btn sm" type="button" data-act="scale-cancel">Cancel</button></div></div>`;
  } else if (sc){
    const how = sc.method === 'scale_bar' && sc.bar ? `scale bar ${sc.bar.length} ${sc.units}` : sc.method;
    sb.innerHTML = `<div class="inline"><span>Scale <span class="val" id="scaleVal">${fmt(sc.value)} ${esc(sc.units)}/px</span> · ${esc(how)}</span></div>
      <div class="inline"><button class="btn sm" type="button" data-act="scale-start">Re-measure</button><button class="btn sm" type="button" data-act="scale-manual">Enter value</button><button class="btn sm" type="button" data-act="scale-remove">Remove</button></div>`;
  } else {
    sb.innerHTML = `<div class="inline"><span style="color:var(--muted)">Uncalibrated · exports in pixels</span></div>
      <div class="inline"><button class="btn sm" type="button" data-act="scale-start" ${imgW() ? '' : 'disabled'}>Measure scale bar</button><button class="btn sm" type="button" data-act="scale-manual" ${imgW() ? '' : 'disabled'}>Enter value</button></div>`;
  }
  $('#sUnits').textContent = sc ? `${fmt(sc.value)} ${sc.units}/px` : 'uncalibrated';

  const T = S.template, its = items(), done = its.filter(isDone).length;
  $('#tplName').textContent = (T.name || T.id || 'Template') + (S.isSample ? ' (sample)' : '');
  $('#tplSub').textContent = `${T.id || '—'} · v${T.version || '—'} · ${(T.landmarks||[]).length} landmarks, ${(T.curves||[]).length} curves`;
  $('#tplCount').textContent = its.length ? `${done} of ${its.length} done` : '';
  $('#tplProg').style.width = its.length ? (100 * done / its.length) + '%' : '0';

  const row = (it, id, name, xy, st) => {
    const sel = S.sel && S.sel.kind === it && S.sel.id === id;
    return `<button type="button" class="row${sel ? ' sel' : ''}" data-act="sel" data-kind="${it}" data-id="${esc(id)}" data-state="${st}"><span class="st ${st}"></span><span class="rid">${esc(id)}</span><span class="rname">${esc(name)}</span><span class="rxy">${xy}</span></button>`;
  };
  let h = '';
  if ((T.landmarks || []).length){
    h += `<div class="grouph">Landmarks</div>`;
    for (const t of T.landmarks){
      const e = lmEntry(t.id), st = itemState({ kind:'lm', id:t.id });
      const xy = st === 'missing' ? 'missing' : e && e.position ? `${f2(e.position[0])}, ${f2(e.position[1])}` : '';
      h += row('lm', t.id, t.name, xy, st);
    }
  }
  if ((T.curves || []).length){
    h += `<div class="grouph">Curves</div>`;
    for (const t of T.curves){
      const c = curveEntry(t.id), st = itemState({ kind:'curve', id:t.id });
      const xy = st === 'missing' ? 'missing' : c && c.points && c.points.length ? `${c.points.length} pts · ${f2(c.length || 0)} px` : c && c.control_points.length ? `${c.control_points.length} clicked` : `${t.n_points ?? 10} pts`;
      h += row('curve', t.id, t.name, xy, st);
    }
  }
  const ah = adhocEntries();
  if (ah.length){
    h += `<div class="grouph">Not in template</div>`;
    for (const e of ah) h += row('lm', e.id, e.label || e.id, e.position ? `${f2(e.position[0])}, ${f2(e.position[1])}` : (e.status === 'missing' ? 'missing' : ''), e.status === 'missing' ? 'missing' : e.position ? (e.status || 'placed') : 'todo');
  }
  if (!h) h = `<div class="empty">The template is empty. Use <b>Edit</b> to list landmarks, <b>Load…</b> to open a template file, or place ad hoc points.</div>`;
  $('#list').innerHTML = h;

  renderDetail();
  renderStrip();
  renderGallery();
  renderSpecimenActions();
  const i = set.specimens.indexOf(cur);
  $('#sSpec').innerHTML = set.specimens.length > 1 ? `<b>${esc(labelOf(cur))}</b> · ${i + 1} of ${set.specimens.length}` : '';
  updateHint();
  if (tplEditor.visible) tplEditor.requestRender();
}

/* ---------- thumbnail strip ---------- */
let stripKey = '';
function renderStrip(){
  const el = $('#strip');
  const key = set.specimens.map(r => `${r.uid}:${r.thumb ? 1 : 0}`).join(',');
  if (key !== stripKey){
    stripKey = key;
    el.innerHTML = set.specimens.map(r => `<button type="button" class="thumb${r.thumb ? '' : ' noimg'}" data-uid="${r.uid}">`
      + (r.thumb ? `<img src="${r.thumb}" alt="">` : `<span class="ph">image not open</span>`)
      + `<span class="badge"></span><span class="tname"></span></button>`).join('')
      + `<button type="button" class="thumb add" data-act="add-images">+ Add images</button>`;
  }
  for (const r of set.specimens){
    const b = el.querySelector(`[data-uid="${r.uid}"]`); if (!b) continue;
    const p = C.progress(r), badge = b.querySelector('.badge');
    badge.textContent = `${p.done}/${p.total}`;
    badge.className = 'badge' + (!p.total ? ' empty' : p.done === p.total ? ' ok' : '');
    b.querySelector('.tname').textContent = labelOf(r);
    b.title = `${labelOf(r)}: ${p.done} of ${p.total} done`;
    b.setAttribute('aria-label', `${labelOf(r)}, ${p.done} of ${p.total} done`);
    b.setAttribute('aria-current', r === cur ? 'true' : 'false');
  }
  const sel = el.querySelector('[aria-current="true"]');
  if (sel && sel.scrollIntoView && el.scrollWidth > el.clientWidth) sel.scrollIntoView({ block:'nearest', inline:'nearest' });
}
$('#strip').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'add-images'){ $('#fImg').click(); return; }
  const rec = set.specimens.find(r => String(r.uid) === b.dataset.uid);
  if (rec && rec !== cur) switchTo(rec);
});

/* ---------- compare view: the selected item on every specimen ---------- */
const GAL_FRACS = [0.02, 0.035, 0.06, 0.1, 0.16];   // crop half-size as a share of the image's longer side
const gal = { open:false, zoom:2, raf:0 };
function setView(compare){
  gal.open = compare;
  $('#vSpecimens').classList.toggle('on', !compare); $('#vSpecimens').setAttribute('aria-pressed', String(!compare));
  $('#vCompare').classList.toggle('on', compare); $('#vCompare').setAttribute('aria-pressed', String(compare));
  $('#strip').hidden = compare; $('#gallery').hidden = !compare; $('#galZoom').hidden = !compare;
  renderGallery();
}
const STATE_TEXT = { placed:'placed', estimated:'estimated', missing:'missing', todo:'not placed', partial:'not finished' };
function renderGallery(){
  if (!gal.open){ $('#galHead').textContent = ''; return; }
  if (gal.raf) return;
  gal.raf = requestAnimationFrame(() => { gal.raf = 0; drawGallery(); });
}
function drawGallery(){
  const el = $('#gallery'), head = $('#galHead');
  const sel = S.sel && S.sel.kind !== 'adhoc' && (S.sel.kind === 'lm' ? tLm(S.sel.id) || lmEntry(S.sel.id) : tCurve(S.sel.id)) ? S.sel : null;
  $('#galCloser').disabled = gal.zoom <= 0; $('#galWider').disabled = gal.zoom >= GAL_FRACS.length - 1;
  if (!sel){
    head.textContent = '';
    el.innerHTML = `<p class="gal-msg">Select a landmark or curve to see it on every specimen.</p>`;
    return;
  }
  const def = sel.kind === 'lm' ? (tLm(sel.id) || lmEntry(sel.id)) : tCurve(sel.id);
  const name = def.name || def.label || '';
  head.innerHTML = `<span class="mono">${esc(sel.id)}</span> <b>${esc(name)}</b> on ${plural(set.specimens.length, 'specimen')}`;
  if (set.specimens.length < 2){
    el.innerHTML = `<p class="gal-msg">Open more images to compare ${esc(sel.id)} across specimens.</p>`;
    return;
  }
  const frac = GAL_FRACS[gal.zoom];
  const key = set.specimens.map(r => r.uid).join(',');
  if (el.dataset.key !== key){
    el.dataset.key = key;
    el.innerHTML = set.specimens.map(r => `<button type="button" class="gtile" data-uid="${r.uid}"><canvas width="264" height="264"></canvas><span class="gempty" hidden></span><span class="gname"><span></span><span></span></span></button>`).join('');
  }
  for (const r of set.specimens){
    const b = el.querySelector(`[data-uid="${r.uid}"]`);
    const v = C.galleryView(r, sel, frac);
    const [nm, st] = b.querySelectorAll('.gname span');
    nm.textContent = labelOf(r);
    st.textContent = STATE_TEXT[v.state] || v.state; st.className = 'st-' + v.state;
    b.setAttribute('aria-current', r === cur ? 'true' : 'false');
    b.setAttribute('aria-label', `${labelOf(r)}: ${sel.id} ${STATE_TEXT[v.state] || v.state}`);
    b.dataset.state = v.state;
    b.dataset.box = v.box ? v.box.map(x => r6(x)).join(',') : '';
    const empty = b.querySelector('.gempty'), cvs = b.querySelector('canvas');
    const blind = r !== cur && C.sameSpecimen(r, cur) && !curDone();
    b.dataset.hidden = blind ? 'true' : 'false';
    const msg = blind ? 'hidden until this replicate is finished' : !r.img ? 'image not open' : !v.box ? (v.state === 'missing' ? 'marked missing' : v.state === 'partial' ? 'curve not finished' : 'not placed yet') : '';
    empty.hidden = !msg; empty.textContent = msg;
    drawTile(cvs.getContext('2d'), r, sel, msg ? null : v.box);
  }
}
function curDone(){ const p = C.progress(cur); return p.done === p.total; }
/** One gallery tile: the crop, the other landmarks as dots, the item itself on top. */
function drawTile(g, r, sel, box){
  const N = 264;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#0B0E12'; g.fillRect(0, 0, N, N);
  if (!box) return;
  const [bx, by, bw] = box, k = N / bw;
  const W = r.img.width, H = r.img.height;
  const x0 = Math.max(0, bx), y0 = Math.max(0, by), x1 = Math.min(W, bx + bw), y1 = Math.min(H, by + bw);
  g.imageSmoothingEnabled = k < 3;
  if (x1 > x0 && y1 > y0) g.drawImage(r.img, x0, y0, x1 - x0, y1 - y0, (x0 - bx) * k, (y0 - by) * k, (x1 - x0) * k, (y1 - y0) * k);
  const mp = p => [(p[0] - bx) * k, (p[1] - by) * k];
  for (const e of r.landmarks){
    if (!e.position || e.status === 'missing' || (sel.kind === 'lm' && e.id === sel.id)) continue;
    const [x, y] = mp(e.position);
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.6)'; g.fill();
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = 'rgba(255,194,61,.9)'; g.fill();
  }
  if (sel.kind === 'lm'){
    const e = r.landmarks.find(x => x.id === sel.id);
    const [x, y] = mp(e.position);
    // the tile canvas is drawn at twice its displayed size, so marks are doubled
    const ring = (w, color, dash) => { g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke(); };
    ring(8, 'rgba(0,0,0,.7)'); ring(4, COL.sel, e.status === 'estimated' ? [10, 8] : null); g.setLineDash([]);
    g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fillStyle = COL.sel; g.fill();
    g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 6;
    const ticks = () => { g.beginPath(); g.moveTo(x - 44, y); g.lineTo(x - 26, y); g.moveTo(x + 26, y); g.lineTo(x + 44, y);
      g.moveTo(x, y - 44); g.lineTo(x, y - 26); g.moveTo(x, y + 26); g.lineTo(x, y + 44); g.stroke(); };
    ticks(); g.strokeStyle = COL.sel; g.lineWidth = 3; ticks();
  } else {
    const c = r.curves.find(x => x.id === sel.id), d = c && c._geom && c._geom.dense;
    if (d && d.length > 1){
      g.beginPath(); d.forEach((p, i) => { const q = mp(p); i ? g.lineTo(...q) : g.moveTo(...q); });
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 7; g.stroke(); g.strokeStyle = COL.sel; g.lineWidth = 3.5; g.stroke();
    }
    for (const p of (c && c.points) || []){
      const [x, y] = mp(p.position);
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.75)'; g.fill();
      g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fillStyle = COL.curve; g.fill();
    }
  }
}
$('#vSpecimens').onclick = () => setView(false);
$('#vCompare').onclick = () => setView(true);
$('#galCloser').onclick = () => { gal.zoom = Math.max(0, gal.zoom - 1); renderGallery(); };
$('#galWider').onclick = () => { gal.zoom = Math.min(GAL_FRACS.length - 1, gal.zoom + 1); renderGallery(); };
$('#gallery').addEventListener('click', e => {
  const b = e.target.closest('.gtile'); if (!b) return;
  const rec = set.specimens.find(r => String(r.uid) === b.dataset.uid);
  if (rec && rec !== cur) switchTo(rec, true);   // keep the landmark selected, ready to fix
});

/* ---------- replicates ---------- */
let repShuffle = true;
function landmarkAgain(){
  if (!cur.img){ toast('Open this specimen’s image first.'); return; }
  const src = cur, n = C.nextReplicate(set.specimens, src);
  const rec = newRecord({ specimen:{ id:src.specimen.id, replicate:n, image:C.clone(src.specimen.image) },
    img:src.img, imgSha:src.imgSha, thumb:src.thumb, isSample:src.isSample });
  if (repShuffle) rec.order = C.shuffledOrder(rec);
  // keep replicates of a specimen next to each other in the strip
  set.specimens.splice(set.specimens.indexOf(rec), 1);
  let at = -1; set.specimens.forEach((r, i) => { if (C.sameSpecimen(r, src)) at = i; });
  set.specimens.splice(at + 1, 0, rec);
  undoStack.length = 0;
  switchTo(rec);
  changed();
  toast(`Replicate ${n} of ${src.specimen.id}: place the landmarks again${repShuffle ? ', in random order' : ''}. Your earlier points stay hidden until you finish.`, 6000);
}
function renderReplicates(){
  const el = $('#repSec');
  const mine = set.specimens.filter(r => C.sameSpecimen(r, cur));
  const any = set.specimens.some(r => set.specimens.some(x => x !== r && C.sameSpecimen(x, r)));
  el.innerHTML = `<div class="eyebrow">Replicates</div>
    <p class="hint">Landmark a specimen again to check how reliably you place landmarks. The replicate uses the same image; your earlier points stay hidden while you place the new ones.</p>
    ${mine.length > 1 ? `<div class="rep-list">${mine.map(r => { const p = C.progress(r);
      return `<button type="button" class="btn sm${r === cur ? ' on' : ''}" data-act="rep-go" data-uid="${r.uid}">r${C.replicateOf(r)} <span class="mono ${p.done === p.total ? 'ok' : 'bad'}">${p.done}/${p.total}</span></button>`; }).join('')}</div>` : ''}
    <label class="check"><input type="checkbox" id="repShuffle"${repShuffle ? ' checked' : ''}> Place landmarks in random order</label>
    <div class="inline">
      <button class="btn sm" type="button" data-act="rep-new"${cur.img ? '' : ' disabled title="Open the image first"'}>Landmark ${esc(cur.specimen.id)} again</button>
      <button class="btn sm" type="button" data-act="rep-summary"${any ? '' : ' disabled title="Landmark a specimen twice first"'}>Repeatability…</button>
    </div>`;
}
function openRepeatability(){
  const r = C.repeatability(exportStates());
  const u = r.units, fmtD = v => v == null ? '—' : (u === 'px' ? v.toFixed(1) : v < 1 ? v.toFixed(3) : v.toFixed(2));
  const rows = r.rows.filter(x => x.pairs).sort((a, b) => b.mean - a.mean);
  const none = r.rows.filter(x => !x.pairs);
  const top = Math.max(...rows.map(x => x.max), 0) || 1;
  const pairs = r.rows.reduce((n, x) => Math.max(n, x.pairs), 0);
  $('#repBody').innerHTML = !r.specimens.length
    ? `<p>No specimen has been landmarked more than once yet. Use “Landmark again” in the Specimen tab, then come back here.</p>`
    : `<p>How far apart your replicates landed, for ${plural(r.specimens.length, 'specimen')} landmarked more than once (${r.specimens.map(x => `${esc(x.id)} ×${x.replicates}`).join(', ')}). Largest differences first.</p>
    ${u === 'px' ? `<p class="hint">In pixels. Measure the scale bar on every specimen to see millimetres instead.</p>` : ''}
    <div class="cb-table"><table class="rep-table"><thead><tr><th>Landmark</th><th class="num">Specimens</th><th class="num">Average (${esc(u)})</th><th class="num">Largest (${esc(u)})</th><th aria-hidden="true"></th></tr></thead><tbody>
      ${rows.map(x => `<tr${x.flag ? ' class="flag"' : ''}><td><span class="mono">${esc(x.id)}</span> ${esc(x.name || '')}${x.flag ? ' <span class="chip">check</span>' : ''}</td>
        <td class="num">${x.specimens}</td><td class="num">${fmtD(x.mean)}</td><td class="num">${fmtD(x.max)}</td>
        <td class="barcell" aria-hidden="true"><span class="rbar"><i style="width:${(100 * x.mean / top).toFixed(1)}%"></i><b style="left:${(100 * x.max / top).toFixed(1)}%"></b></span></td></tr>`).join('')}
    </tbody></table></div>
    ${rows.some(x => x.flag) ? `<p class="hint"><span class="chip">check</span> marks landmarks whose average is more than twice the typical value (${fmtD(r.median)} ${esc(u)}). Re-read their descriptions in the Template tab, or compare them across specimens (G).</p>` : ''}
    ${none.length ? `<p class="hint">Not placed on two replicates yet: ${none.map(x => esc(x.id)).join(', ')}.</p>` : ''}
    <p class="hint">Curves are compared point by point. For a full measurement-error analysis (for example Procrustes ANOVA in geomorph), use Export CSV: it has separate specimen_id and replicate columns.</p>`;
  $('#dRep').showModal();
}
$('#repClose').onclick = () => $('#dRep').close();

function renderSpecimenActions(){
  renderReplicates();
  const el = $('#spActions');
  if (set.specimens.length < 2){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = removing
    ? `<div class="tpl-confirm" style="margin:0"><p class="confirm-text">Remove ${esc(labelOf(cur))} from the set? Its landmarks stay saved in this browser, so opening the image again brings them back.</p>
       <div class="confirm-actions"><button class="btn sm danger" type="button" data-act="remove-yes">Remove</button><button class="btn sm" type="button" data-act="remove-no">Cancel</button></div></div>`
    : `<button class="btn quiet" type="button" data-act="remove-spec">Remove this specimen from the set…</button>`;
}
function renderDetail(){
  const d = $('#detail');
  if (!S.sel){ d.innerHTML = `<div class="eyebrow">Selected</div><div class="empty">Nothing selected.</div>`; return; }
  const sc = scaleObj();
  const statusSeg = cur => `<div class="seg" role="group" aria-label="Status">${C.STATUSES.map(s => `<button type="button" data-act="status" data-status="${s}" class="${cur === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>`;
  if (S.sel.kind === 'adhoc'){
    d.innerHTML = `<div class="eyebrow">Selected</div><div class="dtitle"><span class="nm">New ad hoc point</span></div><div class="desc">Click on the image to place a point that isn't in the template. It is exported after the template points.</div>`;
    return;
  }
  if (S.sel.kind === 'lm'){
    const t = tLm(S.sel.id), e = lmEntry(S.sel.id);
    const pair = t && t.bilateral_pair ? `<div class="desc">Bilateral pair: <span class="rid">${esc(t.bilateral_pair)}</span></div>` : '';
    let coords = '';
    if (e && e.position){
      coords = `<dl class="kv"><dt>x</dt><dd>${f2(e.position[0])} px${sc ? ` · ${f2(e.position[0]*sc.value)} ${esc(sc.units)}` : ''}</dd><dt>y</dt><dd>${f2(e.position[1])} px${sc ? ` · ${f2(e.position[1]*sc.value)} ${esc(sc.units)}` : ''}</dd>${e.placed_at ? `<dt>placed</dt><dd>${esc(e.placed_at)}</dd>` : ''}</dl>`;
    }
    const isAd = !t, hasEntry = !!(e && e.status);
    d.innerHTML = `<div class="eyebrow">Selected</div>
      <div class="dtitle"><span class="rid">${esc(S.sel.id)}</span><span class="nm">${esc(t ? t.name : (e && e.label) || '')}</span></div>
      ${t && t.description ? `<div class="desc">${esc(t.description)}</div>` : ''}${pair}
      ${isAd ? `<div class="field"><label for="adLabel">Label</label><input type="text" id="adLabel" value="${esc(e && e.label || '')}"></div>` : ''}
      <div class="inline">${statusSeg(e ? e.status : null)}</div>
      ${coords}
      <div class="field"><label for="lmNote">Note</label><input type="text" id="lmNote" value="${esc(e && e.note || '')}" placeholder="${hasEntry ? 'e.g. broken, estimated from other side' : 'Place or mark it first'}" ${hasEntry ? '' : 'disabled'}></div>
      <div class="inline"><button class="btn sm" type="button" data-act="next">Next to-do</button>
      <button class="btn sm" type="button" data-act="clear" ${e ? '' : 'disabled'}>${isAd ? 'Delete point' : 'Clear'}</button></div>`;
    return;
  }
  const t = tCurve(S.sel.id), c = curveEntry(S.sel.id);
  if (!t){ d.innerHTML = ''; return; }
  const g = c && c._geom;
  const anch = t.closed ? 'closed loop' : [t.start ? `starts on ${t.start}` : 'free start', t.end ? `ends on ${t.end}` : 'free end'].join(', ');
  d.innerHTML = `<div class="eyebrow">Selected curve</div>
    <div class="dtitle"><span class="rid">${esc(t.id)}</span><span class="nm">${esc(t.name)}</span></div>
    ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ''}
    <dl class="kv"><dt>path</dt><dd>${esc(t.path || 'polyline')}, equal arc length</dd><dt>anchors</dt><dd>${esc(anch)}</dd>
    <dt>clicked</dt><dd>${c ? c.control_points.length : 0} control points</dd>
    <dt>output</dt><dd>${t.n_points ?? 10} semilandmarks${t.closed ? '' : ' (excl. anchored ends)'}</dd>
    ${c && c.points && c.points.length ? `<dt>length</dt><dd>${f2(c.length)} px${sc ? ` · ${f2(c.length * sc.value)} ${esc(sc.units)}` : ''}</dd>` : ''}</dl>
    ${g && g.err ? `<div class="warnbox"><span>${esc(g.err)}</span></div>` : ''}
    <div class="inline">${statusSeg(c ? (c.points && c.points.length || c.status === 'missing' ? c.status : null) : null)}</div>
    <div class="field"><label for="lmNote">Note</label><input type="text" id="lmNote" value="${esc(c && c.note || '')}"></div>
    <div class="inline"><button class="btn sm" type="button" data-act="undo-cp" ${c && c.control_points.length ? '' : 'disabled'}>Remove last point</button>
    <button class="btn sm" type="button" data-act="clear" ${c ? '' : 'disabled'}>Clear curve</button>
    <button class="btn sm" type="button" data-act="next">Next to-do</button></div>`;
}

function setStatus(st){
  if (!S.sel || S.sel.kind === 'adhoc') return;
  pushUndo();
  const res = C.setStatus(S, S.sel, st);
  if (res === 'needs_position') toast('Click on the image to place it');
  if (st === 'missing' && (S.sel.kind === 'curve' || tLm(S.sel.id))){ const nx = nextTodo(); if (nx) S.sel = nx; }
  changed();
}
function clearSel(){
  if (!S.sel || S.sel.kind === 'adhoc') return;
  pushUndo();
  const wasAd = S.sel.kind === 'lm' && !tLm(S.sel.id);
  C.clearItem(S, S.sel);
  if (wasAd) S.sel = null;
  changed();
}

/* ---------- scale ---------- */
function startScale(){ S.tool = 'scale'; S.scaleDraft = []; S.scaleManual = false; renderSide(); draw(); }
function cancelScale(){ S.tool = 'place'; S.scaleDraft = []; S.scaleManual = false; renderSide(); draw(); }
function applyScale(){
  let sc;
  try { sc = C.scaleFromBar(S.scaleDraft, parseFloat($('#barLen').value), $('#barUnits').value); }
  catch (e){ toast(e.message); return; }
  pushUndo();
  S.specimen.image.scale = sc;
  S.tool = 'place'; S.scaleDraft = []; toast(`Scale set: ${fmt(sc.value)} ${sc.units} per pixel`); changed();
}
function applyManual(){
  const v = parseFloat($('#manVal').value);
  if (!(v > 0)){ toast('Enter a value greater than zero'); return; }
  pushUndo();
  S.specimen.image.scale = { value:v, units:$('#manUnits').value, method:$('#manMethod').value };
  S.scaleManual = false; changed();
}

/* ---------- template ---------- */
function applyTemplate(t){
  pushUndo();
  C.applyTemplate(S, t);
  if (!S.sel || S.sel.kind === 'adhoc' || !(S.sel.kind === 'lm' ? (tLm(S.sel.id) || lmEntry(S.sel.id)) : tCurve(S.sel.id))) S.sel = C.nextTodo(S, null, S.order);
  changed();
}

/* ---------- opening images and files ---------- */
function makeThumb(src){
  const k = Math.min(224 / src.width, 168 / src.height, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
function imageWarnings(im, sha, bmp){
  const msgs = [];
  if (im.sha256 && sha && im.sha256 !== sha) msgs.push(`This image's checksum differs from the one in the file (${im.file}). If the image was edited or resized, every landmark may be shifted.`);
  if (im.width && (im.width !== bmp.width || im.height !== bmp.height)) msgs.push(`Size is ${bmp.width} × ${bmp.height}, the file says ${im.width} × ${im.height}.`);
  return msgs.join(' ') || null;
}
function loadSaved(sha, replicate){
  try {
    const t = sha && localStorage.getItem('lmk2d:' + sha + (replicate > 1 ? ':r' + replicate : ''));
    return t ? C.parseDoc(JSON.parse(t), 'Saved work') : null;
  } catch { return null; }
}
function uniqueId(id, except){
  let out = id || 'specimen', k = 2;
  while (set.specimens.some(r => r !== except && r.specimen.id === out && C.replicateOf(r) === C.replicateOf(except || { specimen:{} }))) out = `${id}_${k++}`;
  return out;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Open images. Each becomes a specimen, unless it is the image an opened
 * landmark file is waiting for (matched by checksum, then by file name).
 * Unsaved work kept in this browser is restored when the template matches.
 */
async function openImages(fileList){
  const files = [...fileList].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
  if (!files.length) return;
  const added = [], notes = [];
  let restored = 0, already = 0;
  for (const file of files){
    let sha, bmp;
    try {
      const buf = await file.arrayBuffer();
      sha = await C.sha256Hex(buf);
      bmp = await createImageBitmap(new Blob([buf], { type:file.type || 'image/png' }));
    } catch { notes.push(`Couldn't read ${file.name}. Use JPG, PNG or WebP.`); continue; }
    if (set.specimens.some(r => r.img && r.specimen.image.sha256 === sha)){ already++; continue; }
    // specimens (and their replicates) opened from landmark files and waiting for this image
    let waiting = set.specimens.filter(r => !r.img && !r.isSample && r.specimen.image.sha256 === sha);
    if (!waiting.length) waiting = set.specimens.filter(r => !r.img && !r.isSample && r.specimen.image.file === file.name);
    if (!waiting.length && files.length === 1 && cur && !cur.img && !cur.isSample) waiting = set.specimens.filter(r => r === cur || (!r.img && C.sameSpecimen(r, cur)));
    if (waiting.length){
      const thumb = makeThumb(bmp);
      for (const w of waiting){
        w.warn = imageWarnings(w.specimen.image, sha, bmp);
        w.img = bmp; w.imgSha = sha; w.thumb = thumb; w.view = null;
        w.specimen.image = { ...w.specimen.image, file:file.name, sha256:sha, width:bmp.width, height:bmp.height };
      }
      added.push(waiting[0]); continue;
    }
    let rec;
    if (set.specimens.some(r => r.isSample)) resetSet();   // the sample makes way for real images
    rec = newRecord({ specimen:{ id:C.stem(file.name), image:{ file:file.name, sha256:sha, width:bmp.width, height:bmp.height } },
      img:bmp, imgSha:sha, thumb:makeThumb(bmp) });
    const saved = loadSaved(sha);
    if (saved){
      const fresh = templateIsBlank() && !set.specimens.some(r => r !== rec && hasData(r));
      const diff = fresh ? null : C.templateDifference(set.template, saved.template);
      if (diff) notes.push(`Saved work on ${file.name} wasn't restored: ${diff}.`);
      else {
        if (fresh) set.template = saved.template;
        Object.assign(rec, { raw:saved.raw, landmarks:saved.landmarks, curves:saved.curves, provenance:saved.provenance,
          specimen:{ ...saved.specimen, image:{ ...saved.specimen.image, file:file.name } } });
        restored++;
        // replicates of this image saved in this browser come back too
        for (let n = 2; n < 100; n++){
          const more = loadSaved(sha, n); if (!more) break;
          if (C.templateDifference(set.template, more.template)) continue;
          newRecord({ raw:more.raw, landmarks:more.landmarks, curves:more.curves, provenance:more.provenance,
            specimen:{ ...more.specimen, image:{ ...more.specimen.image, file:file.name } }, img:bmp, imgSha:sha, thumb:rec.thumb });
        }
      }
    }
    rec.specimen.id = uniqueId(rec.specimen.id, rec);
    added.push(rec);
  }
  if (added.length){
    undoStack.length = 0;
    switchTo(added[0]);
    changed();
  }
  let msg;
  if (files.length === 1 && added.length === 1) msg = restored ? `Restored your unsaved work on ${files[0].name} from this browser` : `Opened ${files[0].name}`;
  else if (added.length) msg = `Opened ${plural(added.length, 'image')}` + (restored ? `, with saved work restored for ${restored}` : '') + '.';
  else msg = '';
  if (already) msg += ` ${plural(already, 'image')} ${already === 1 ? 'was' : 'were'} already open.`;
  if (notes.length) msg += ' ' + notes.join(' ');
  if (msg.trim()) toast(msg.trim(), notes.length ? 8000 : 4000);
}

/** Read .lmk.json, template .json and .zip files into [{ source, name, doc | error }]. */
async function readDataFiles(fileList){
  const out = [];
  const parse = (source, name, text) => {
    try { out.push({ source, name, doc:JSON.parse(text) }); }
    catch { out.push({ source, name, error:`${name} is not valid JSON` }); }
  };
  for (const f of fileList){
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip'){
      try {
        const parts = (await C.unzipFiles(new Uint8Array(await f.arrayBuffer()))).filter(x => /\.json$/i.test(x.name));
        if (!parts.length) out.push({ source:f.name, name:f.name, error:`${f.name} has no landmark files in it` });
        for (const x of parts) parse(f.name, x.name.split('/').pop(), new TextDecoder().decode(x.data));
      } catch (e){ out.push({ source:f.name, name:f.name, error:`${f.name}: ${e.message}` }); }
    } else parse(f.name, f.name, await f.text());
  }
  return out;
}

/** Open landmark files (or a hand-in zip) into the set. All must use the set's template. */
async function openDataFiles(fileList){
  const entries = await readDataFiles([...fileList]);
  const added = [], problems = [];
  for (const en of entries){
    if (en.error){ problems.push(en.error + '.'); continue; }
    const kind = C.sniffJson(en.doc);
    if (kind === 'template'){
      try { applyTemplate(C.checkTemplate(en.doc)); toast(`Loaded template ${en.doc.name || en.doc.id || en.name}`); }
      catch (e){ problems.push(e.message); }
      continue;
    }
    if (kind !== 'doc'){ problems.push(`${en.name} is neither a landmark file nor a template.`); continue; }
    let st;
    try { st = C.parseDoc(en.doc, en.name); } catch (e){ problems.push(e.message); continue; }
    if (set.specimens.every(r => r.isSample)){ resetSet(st.template); cur = null; }
    else if (templateIsBlank() && !set.specimens.some(hasData)) set.template = st.template;
    else {
      const diff = C.templateDifference(set.template, st.template);
      if (diff){ problems.push(`${en.name} was not opened: ${diff}. All specimens in a set must use the same template.`); continue; }
    }
    const fields = { raw:st.raw, landmarks:st.landmarks, curves:st.curves, provenance:st.provenance };
    const bySha = set.specimens.find(r => r.specimen.image.sha256 && r.specimen.image.sha256 === st.specimen.image.sha256 && C.replicateOf(r) === C.replicateOf(st));
    let rec;
    if (bySha && !hasData(bySha)){   // its image is already open: fill it in
      rec = Object.assign(bySha, fields, { specimen:{ ...st.specimen, image:{ ...st.specimen.image, file:bySha.specimen.image.file } } });
    } else if (set.specimens.some(r => r.specimen.id === st.specimen.id && C.replicateOf(r) === C.replicateOf(st))){
      problems.push(`${st.specimen.id} is already open, so ${en.name} was skipped.`); continue;
    } else {
      const sibling = set.specimens.find(r => r.img && r.specimen.image.sha256 && r.specimen.image.sha256 === st.specimen.image.sha256);
      rec = newRecord({ ...fields, specimen:st.specimen, ...(sibling ? { img:sibling.img, imgSha:sibling.imgSha, thumb:sibling.thumb } : {}) });
    }
    added.push(rec);
  }
  if (added.length){
    undoStack.length = 0;
    switchTo(added[0]);
    changed();
    const waiting = added.filter(r => !r.img);
    let msg = added.length === 1 ? `Opened ${entries.find(e => !e.error && e.doc && C.sniffJson(e.doc) === 'doc').name}.` : `Opened ${plural(added.length, 'specimen')}.`;
    if (waiting.length === 1) msg += ` Now open ${waiting[0].specimen.image.file || 'its image'}.`;
    else if (waiting.length > 1) msg += ` Now open their ${waiting.length} images (you can select them all at once).`;
    toast([msg, ...problems].join(' '), problems.length ? 9000 : 5000);
  } else if (problems.length) toast(problems.join(' '), 7000);
}

let saveT;
function autosave(){
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    let n = 0;
    for (const r of set.specimens){
      const key = r.imgSha || r.specimen.image?.sha256;
      if (r.isSample || !key) continue;
      const n_ = C.replicateOf(r);
      try { localStorage.setItem('lmk2d:' + key + (n_ > 1 ? ':r' + n_ : ''), JSON.stringify(C.buildDoc(r, { operator:operator() || undefined }))); n++; } catch {}
    }
    if (n) $('#sSave').textContent = 'kept in this browser ' + new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }, 500);
}

/* ---------- export ---------- */
/** The set as plain states for export, with the operator name filled in. */
function exportStates(){
  return set.specimens.map(r => ({ raw:r.raw, specimen:r.specimen, template:set.template, landmarks:r.landmarks, curves:r.curves,
    provenance:{ ...r.provenance, ...(operator() ? { operator:operator() } : {}) } }));
}
function exportBase(){
  return set.specimens.length === 1 ? (C.safeName(cur.specimen.id) || 'specimen') : `${C.safeName(operator()) || 'specimens'}_landmarks`;
}
function exportNote(states){
  const n = states.reduce((k, st) => k + C.notDoneCount(C.exportRows(st)), 0);
  return n ? ` ${n} point${n === 1 ? ' was' : 's were'} not done and ${n === 1 ? 'is' : 'are'} written as missing.` : '';
}
function exportTPS(){ if (!imgW()){ toast('Open an image first'); return; } const st = exportStates(); saveFile(`${exportBase()}.tps`, C.toTPS(st), exportNote(st)); }
function exportCSV(){ if (!imgW()){ toast('Open an image first'); return; } const st = exportStates(); saveFile(`${exportBase()}.csv`, C.toCSV(st), exportNote(st)); }

/* ---------- hand-in (students) ---------- */
function openHandIn(){
  if (set.specimens.every(r => r.isSample)){ toast('Open your own images first. The sample is not part of a hand-in.', 5000); return; }
  $('#hiName').value = operator();
  $('#hiErr').textContent = '';
  const rows = set.specimens.map(r => { const p = C.progress(r); return { id:labelOf(r), ...p }; });
  const unfinished = rows.filter(r => r.done < r.total);
  $('#hiSummary').innerHTML = `<p class="hint">${plural(rows.length, 'specimen')} in this hand-in:</p>
    <ul class="hi-list">${rows.map(r => `<li><span class="mono">${esc(r.id)}</span><span class="mono ${r.done === r.total ? 'ok' : 'bad'}">${r.done}/${r.total}</span></li>`).join('')}</ul>
    ${unfinished.length ? `<p class="hint">${plural(unfinished.length, 'specimen')} ${unfinished.length === 1 ? 'isn’t' : 'aren’t'} finished. You can still hand in: points not done are written as missing.</p>` : ''}`;
  $('#dHandin').showModal();
  $('#hiName').focus();
}
$('#handinForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#hiName').value.trim();
  if (!name){ $('#hiErr').textContent = 'Enter your name, so your instructor can tell your files apart.'; $('#hiName').focus(); return; }
  $('#opName').value = name;
  try { localStorage.setItem('lmk2d:operator', name); } catch {}
  const zip = C.zipFiles(C.handInFiles(exportStates(), { operator:name }));
  $('#dHandin').close();
  autosave();
  saveFile(`${C.safeName(name) || 'hand-in'}_landmarks.zip`, zip);
});
$('#hiCancel').onclick = () => $('#dHandin').close();

/* ---------- combine hand-ins (instructors) ---------- */
let combined = null;
async function runCombine(fileList){
  const entries = await readDataFiles([...fileList]);
  const unreadable = entries.filter(e => e.error).map(e => ({ source:e.source, name:e.name, reason:e.error + '.' }));
  combined = C.combineEntries(entries.filter(e => !e.error));
  combined.refused.unshift(...unreadable);
  const r = combined;
  const list = (rows, title) => rows.length ? `<p class="cb-h">${title}</p><ul class="cb-list">${rows.map(x => `<li><b>${esc(x.source && x.source !== x.name ? x.source + ' › ' + x.name : x.name)}</b> ${esc(x.reason)}</li>`).join('')}</ul>` : '';
  $('#cbResult').innerHTML = r.states.length ? `
    <p><b>${plural(r.states.length, 'specimen')}</b> from ${plural(r.operators.length, 'student')} will be combined, using the template “${esc(r.template.name || r.template.id)}”.</p>
    <div class="cb-table"><table><thead><tr><th>Student</th><th>Specimens</th><th>Finished</th></tr></thead><tbody>
      ${r.operators.map(o => `<tr><td>${esc(o.operator)}</td><td class="num">${o.specimens}</td><td class="num ${o.complete === o.specimens ? 'ok' : 'bad'}">${o.complete}</td></tr>`).join('')}
    </tbody></table></div>
    ${r.shared.length ? `<p class="hint">Done by more than one student: ${r.shared.map(x => `${esc(x.id)} (${x.operators})`).join(', ')}. Their IDs get the student’s name added, e.g. <span class="mono">${esc(r.ids[r.states.findIndex(st => st.specimen.id === r.shared[0].id)])}</span>, so you can use them for between-student error.</p>` : ''}
    ${list(r.refused, 'Not combined')}${list(r.skipped, 'Skipped (already included)')}`
    : `<p>Nothing could be combined.</p>${list(r.refused, 'Not combined')}`;
  $('#cbTps').disabled = $('#cbCsv').disabled = !r.states.length;
}
function openCombine(){ combined = null; $('#cbResult').innerHTML = ''; $('#cbTps').disabled = $('#cbCsv').disabled = true; $('#dCombine').showModal(); }
$('#cbChoose').onclick = () => $('#fCombine').click();
$('#fCombine').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) runCombine(f); };
$('#cbTps').onclick = () => combined && saveFile('combined_landmarks.tps', C.toTPS(combined.states, combined.ids));
$('#cbCsv').onclick = () => combined && saveFile('combined_landmarks.csv', C.toCSV(combined.states, combined.ids));
$('#cbClose').onclick = () => $('#dCombine').close();

/* ---------- saving files ----------
 * Inside a claude.ai artifact, downloads go through the `downloads` capability
 * (which only allows some extensions, so .tps becomes .tps.txt there).
 * Anywhere else (GitHub Pages, a local copy) a normal download link is used. */
let dlP = null;
async function saveFile(name, data, note = ''){
  const binary = typeof data !== 'string';
  const c = window.claude;
  if (c && typeof c.use === 'function'){
    if (!dlP) dlP = Promise.resolve(c.use('downloads')).catch(() => null);
    const dl = await dlP;
    if (dl){
      const fname = /\.(json|csv|txt|zip)$/i.test(name) ? name : name + '.txt';
      try { await dl.save({ filename:fname, data }); toast((fname === name ? `Saved ${name}.` : `Saved ${fname}. Rename it to ${name}.`) + note, 6000); }
      catch (e){
        if (e && e.code === 'declined') return;
        if (e && e.code === 'rate_limited'){ toast('A save prompt is already open'); return; }
        if (binary) toast(`${name} couldn't be saved here (${e && e.message || 'download refused'}).`, 6000); else showText(name, data);
      }
      return;
    }
    if (binary) toast(`${name} can't be saved in this view. Open the app from its web address to download it.`, 7000); else showText(name, data);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: /\.zip$/i.test(name) ? 'application/zip' : 'text/plain' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Saved ${name}.` + note, 5000);
}
function showText(name, text){ $('#txtTitle').textContent = name; $('#txtBody').value = text; $('#dText').showModal(); }
$('#txtClose').onclick = () => $('#dText').close();
$('#txtCopy').onclick = () => {
  const ta = $('#txtBody');
  const fallback = () => { ta.focus(); ta.select(); toast('Selected. Press Ctrl+C to copy.'); };
  try { navigator.clipboard.writeText(ta.value).then(() => toast('Copied'), fallback); } catch { fallback(); }
};

/* ---------- pointer ---------- */
const ptrs = new Map(); let gesture = null, spaceDown = false;
const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function hitTest(sx, sy, tol){
  let best = null, bd = tol;
  const test = (p, hit) => { const [x, y] = toScr(p); const d = Math.hypot(x - sx, y - sy); if (d <= bd){ bd = d; best = { ...hit, pos:p }; } };
  if (S.tool === 'place'){
    const sc = scaleObj();
    if (sc && sc.bar && sc.bar.points) sc.bar.points.forEach((p, i) => test(p, { kind:'bar', i }));
    for (const c of S.curves) (c.control_points || []).forEach((cp, i) => test(cp.position, { kind:'cp', id:c.id, i }));
    for (const e of S.landmarks) if (e.position && e.status !== 'missing') test(e.position, { kind:'lm', id:e.id });
  }
  return best;
}
function moveHit(h, p){
  const W = imgW(), H = imgH();
  const q = [r6(clamp(p[0], 0, W)), r6(clamp(p[1], 0, H))];
  if (h.kind === 'lm'){ const e = lmEntry(h.id); e.position = q; e.placed_at = C.nowIso(); }
  else if (h.kind === 'cp'){ curveEntry(h.id).control_points[h.i].position = q; }
  else if (h.kind === 'bar'){ const sc = scaleObj(); sc.bar.points[h.i] = q; const px = dist(sc.bar.points[0], sc.bar.points[1]); if (px > 0) sc.value = r6(sc.bar.length / px); }
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  try { cv.setPointerCapture(e.pointerId); } catch {}
  S.pointerType = e.pointerType;
  const [x, y] = local(e); ptrs.set(e.pointerId, [x, y]);
  if (ptrs.size === 2){
    const [a, b] = [...ptrs.values()];
    gesture = { type:'pinch', d0:dist(a, b), s0:S.view.s, m0:[(a[0]+b[0])/2, (a[1]+b[1])/2], ox:S.view.ox, oy:S.view.oy };
    return;
  }
  if (ptrs.size > 2) return;
  if (e.button === 1 || e.button === 2 || spaceDown){ gesture = { type:'pan', x0:x, y0:y, ox:S.view.ox, oy:S.view.oy, moved:true }; stage.classList.add('panning'); return; }
  const hit = hitTest(x, y, e.pointerType === 'touch' ? 18 : 10);
  let off = [0, 0];
  if (hit){ const p = toImg(x, y); off = [p[0] - hit.pos[0], p[1] - hit.pos[1]]; }
  gesture = { type:hit ? 'drag' : 'press', hit, off, x0:x, y0:y, ox:S.view.ox, oy:S.view.oy, moved:false, pushed:false };
});
cv.addEventListener('pointermove', e => {
  const [x, y] = local(e); S.pointerType = e.pointerType;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [x, y]);
  S.hover = toImg(x, y); S.hoverScr = [x, y];
  const sc = scaleObj();
  $('#sPos').innerHTML = `x <b>${f2(S.hover[0])}</b> y <b>${f2(S.hover[1])}</b> px` + (sc ? ` · ${f2(S.hover[0]*sc.value)}, ${f2(S.hover[1]*sc.value)} ${esc(sc.units)}` : '');
  if (!gesture){ draw(); return; }
  if (gesture.type === 'pinch'){
    if (ptrs.size < 2) return;
    const [a, b] = [...ptrs.values()], m = [(a[0]+b[0])/2, (a[1]+b[1])/2];
    const s = clamp(gesture.s0 * dist(a, b) / gesture.d0, 0.02, 64);
    const pImg = [(gesture.m0[0] - gesture.ox) / gesture.s0, (gesture.m0[1] - gesture.oy) / gesture.s0];
    S.view = { s, ox:m[0] - pImg[0]*s, oy:m[1] - pImg[1]*s }; draw(); return;
  }
  const dx = x - gesture.x0, dy = y - gesture.y0;
  if (!gesture.moved && Math.hypot(dx, dy) > 4){ gesture.moved = true; if (gesture.type === 'press'){ gesture.type = 'pan'; stage.classList.add('panning'); } }
  if (gesture.type === 'pan'){ S.view.ox = gesture.ox + dx; S.view.oy = gesture.oy + dy; draw(); }
  else if (gesture.type === 'drag' && gesture.moved){
    if (!gesture.pushed){ pushUndo(); gesture.pushed = true; }
    moveHit(gesture.hit, [S.hover[0] - gesture.off[0], S.hover[1] - gesture.off[1]]);
    C.recomputeCurves(S); draw();
  }
});
function endPointer(e){
  ptrs.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch'){ if (ptrs.size === 0) gesture = null; return; }
  gesture = null; stage.classList.remove('panning');
  if (e.type === 'pointercancel'){ draw(); return; }
  const [x, y] = local(e);
  if (g.type === 'press' && !g.moved) handleClick(toImg(x, y));
  else if (g.type === 'drag'){
    if (g.hit.kind === 'lm') S.sel = { kind:'lm', id:g.hit.id };
    else if (g.hit.kind === 'cp') S.sel = { kind:'curve', id:g.hit.id };
    if (g.moved) changed(); else { renderSide(); draw(); }
  } else draw();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { if (!gesture){ S.hover = null; S.hoverScr = null; draw(); } });
cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), x, y); }, { passive:false });

/* ---------- side panel events ---------- */
$('#side').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'sel'){ S.sel = { kind:b.dataset.kind, id:b.dataset.id }; if (S.tool !== 'place') cancelScale(); renderSide(); draw(); }
  else if (act === 'status') setStatus(b.dataset.status);
  else if (act === 'clear') clearSel();
  else if (act === 'next'){ const n = nextTodo(); if (n){ S.sel = n; renderSide(); draw(); } else toast('Every template point is done'); }
  else if (act === 'undo-cp'){ const c = S.sel && curveEntry(S.sel.id); if (c && c.control_points.length){ pushUndo(); c.control_points.pop(); changed(); } }
  else if (act === 'adhoc'){ S.sel = { kind:'adhoc' }; renderSide(); draw(); }
  else if (act === 'scale-start') startScale();
  else if (act === 'scale-cancel') cancelScale();
  else if (act === 'scale-apply') applyScale();
  else if (act === 'scale-manual'){ S.scaleManual = true; S.tool = 'place'; renderSide(); }
  else if (act === 'scale-manual-apply') applyManual();
  else if (act === 'scale-remove'){ pushUndo(); delete S.specimen.image.scale; changed(); }
  else if (act === 'goto-template') selectTab($('#t-template'));
  else if (act === 'combine') openCombine();
  else if (act === 'rep-new') landmarkAgain();
  else if (act === 'rep-summary') openRepeatability();
  else if (act === 'rep-go'){ const r = set.specimens.find(x => String(x.uid) === b.dataset.uid); if (r && r !== cur) switchTo(r); }
  else if (act === 'remove-spec'){ removing = true; renderSpecimenActions(); }
  else if (act === 'remove-no'){ removing = false; renderSpecimenActions(); }
  else if (act === 'remove-yes'){ removing = false; removeCurrent(); }
  else if (act === 'dismiss-warn'){ S.warn = null; renderSide(); }
});
$('#side').addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'lmNote' && S.sel){
    const ent = S.sel.kind === 'lm' ? lmEntry(S.sel.id) : C.ensureCurve(S, S.sel.id);
    const v = e.target.value.trim();
    if (ent){ if (v) ent.note = v; else delete ent.note; }
    autosave();
  } else if (id === 'adLabel' && S.sel){ const ent = lmEntry(S.sel.id); if (ent){ ent.label = e.target.value.trim(); changed(); } }
  else if (id === 'spId'){
    const v = e.target.value.trim();
    if (!v){ e.target.value = S.specimen.id; return; }
    if (set.specimens.some(r => !C.sameSpecimen(r, cur) && r.specimen.id === v)){
      toast(`Another specimen in the set is already called ${v}.`); e.target.value = S.specimen.id; return;
    }
    for (const r of set.specimens.filter(r => r !== cur && C.sameSpecimen(r, cur))) r.specimen.id = v;   // its replicates
    S.specimen.id = v; renderSide(); autosave();
  }
  else if (id === 'spNotes'){ S.specimen.notes = e.target.value.trim(); autosave(); }
  else if (id === 'repShuffle'){ repShuffle = e.target.checked; }
  else if (id === 'opName'){ try { localStorage.setItem('lmk2d:operator', e.target.value.trim()); } catch {} autosave(); }
});

$('#tplForm').addEventListener('submit', e => {
  e.preventDefault();
  try { const t = C.textToTpl($('#tplText').value, S.template); applyTemplate(t); $('#dTpl').close(); toast('Template updated'); }
  catch (err){ $('#tplErr').textContent = err.message; }
});
$('#tplCancel').onclick = () => $('#dTpl').close();

/* ---------- toolbar ---------- */
$('#bOpenImg').onclick = () => $('#fImg').click();
$('#bOpenDoc').onclick = () => $('#fDoc').click();
$('#fImg').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) openImages(f); };
$('#fDoc').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) openDataFiles(f); };
$('#bHandin').onclick = openHandIn;
$('#fTpl').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  f.text().then(txt => {
    try { const d = JSON.parse(txt); applyTemplate(C.checkTemplate(C.sniffJson(d) === 'doc' ? d.template : d)); toast('Template loaded'); }
    catch (err){ toast(err.message || 'Not a template file', 6000); }
  }); };
$('#bSave').onclick = () => {
  if (!imgW()){ toast('Open an image first'); return; }
  const d = C.buildDoc(S, { operator:operator() || undefined }); saveFile(C.docFileName(cur), JSON.stringify(d, null, 2) + '\n');
};
$('#bTps').onclick = exportTPS;
$('#bCsv').onclick = exportCSV;
$('#bUndo').onclick = undo;
$('#bLabels').onclick = () => { S.labels = !S.labels; $('#bLabels').classList.toggle('on', S.labels); draw(); };
$('#bLoupe').onclick = () => { S.loupe = !S.loupe; $('#bLoupe').classList.toggle('on', S.loupe); draw(); };
$('#zIn').onclick = () => { const [w, h] = stageSize(); zoomAt(1.4, w/2, h/2); };
$('#zOut').onclick = () => { const [w, h] = stageSize(); zoomAt(1/1.4, w/2, h/2); };
$('#zFit').onclick = fit;

let dragDepth = 0;
stage.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('dragleave', () => { if (--dragDepth <= 0){ dragDepth = 0; $('#drop').hidden = true; } });
stage.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  const files = [...(e.dataTransfer?.files || [])];
  const data = files.filter(f => /\.(json|zip)$/i.test(f.name)), imgs = files.filter(f => /^image\//.test(f.type));
  if (data.length) await openDataFiles(data);
  if (imgs.length) await openImages(imgs);
});

document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select,dialog')) return;
  if (e.key === ' '){ spaceDown = true; e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'escape'){ if (S.tool !== 'place') cancelScale(); return; }
  if (e.key === '[' || e.key === ']'){ stepSpecimen(e.key === ']' ? 1 : -1); return; }
  if (k === 'g'){ setView(!gal.open); return; }
  if (k === 'n'){ e.preventDefault(); const n = nextTodo(); if (n){ S.sel = n; renderSide(); draw(); } else toast('Every template point is done'); return; }
  if (k === 'm'){ setStatus('missing'); return; }
  if (k === 'e'){ if (S.sel && S.sel.kind === 'lm'){ const ent = lmEntry(S.sel.id); setStatus(ent && ent.status === 'estimated' ? 'placed' : 'estimated'); } else setStatus('estimated'); return; }
  if (e.key === 'Delete'){ clearSel(); return; }
  if (e.key === 'Backspace'){ e.preventDefault(); const c = S.sel && S.sel.kind === 'curve' && curveEntry(S.sel.id); if (c && c.control_points.length){ pushUndo(); c.control_points.pop(); changed(); } else clearSel(); return; }
  if (k === 'f'){ fit(); return; }
  if (k === 'l'){ $('#bLabels').click(); return; }
  if (k === '+' || k === '='){ $('#zIn').click(); return; }
  if (k === '-'){ $('#zOut').click(); return; }
  const arrows = { arrowleft:[-1,0], arrowright:[1,0], arrowup:[0,-1], arrowdown:[0,1] };
  if (arrows[k] && S.sel && S.sel.kind === 'lm'){
    const ent = lmEntry(S.sel.id); if (!ent || !ent.position) return;
    e.preventDefault(); pushUndo();
    const step = e.shiftKey ? 1 : 0.25;
    moveHit({ kind:'lm', id:ent.id }, [ent.position[0] + arrows[k][0]*step, ent.position[1] + arrows[k][1]*step]); changed();
  }
});
document.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

/* ---------- sample specimen ---------- */
function bez(P0, P1, P2, P3, t){ const u = 1 - t; return [0,1].map(i => u*u*u*P0[i] + 3*u*u*t*P1[i] + 3*u*t*t*P2[i] + t*t*t*P3[i]); }
function makeSample(){
  const W = 1600, H = 1100, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#E7E4DA'; g.fillRect(0, 0, W, H);
  const id = g.getImageData(0, 0, W, H), px = id.data;
  for (let i = 0; i < px.length; i += 4){ const n = (Math.random() - .5) * 10; px[i] += n; px[i+1] += n; px[i+2] += n; }
  g.putImageData(id, 0, 0);
  const B = [380, 560], A = [1400, 548], U1 = [620, 250], U2 = [1150, 300], L1 = [1130, 800], L2 = [640, 880];
  g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
  g.beginPath(); g.moveTo(...B); g.bezierCurveTo(...U1, ...U2, ...A); g.bezierCurveTo(...L1, ...L2, ...B); g.closePath();
  const gr = g.createLinearGradient(0, 260, 0, 860); gr.addColorStop(0, '#4E7A36'); gr.addColorStop(.5, '#5F8F42'); gr.addColorStop(1, '#3E6A2C');
  g.fillStyle = gr; g.fill(); g.restore();
  g.lineWidth = 2.5; g.strokeStyle = '#2F5121'; g.stroke();
  g.lineCap = 'round'; g.strokeStyle = '#6A7F3A'; g.lineWidth = 11;
  g.beginPath(); g.moveTo(200, 578); g.quadraticCurveTo(290, 574, 384, 560); g.stroke();
  g.strokeStyle = '#B9C98A'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(...B); g.quadraticCurveTo(900, 540, 1390, 548); g.stroke();
  g.lineWidth = 2; g.strokeStyle = 'rgba(205,220,160,.75)';
  for (let i = 1; i <= 9; i++){
    const t = i / 10.5, m = [ (1-t)*(1-t)*B[0] + 2*(1-t)*t*900 + t*t*1390, (1-t)*(1-t)*B[1] + 2*(1-t)*t*540 + t*t*548 ];
    const up = bez(B, U1, U2, A, Math.min(t + .1, .97)), lo = bez(B, L2, L1, A, Math.min(t + .1, .97));
    for (const e of [up, lo]){ g.beginPath(); g.moveTo(...m); g.quadraticCurveTo(m[0] + (e[0]-m[0])*.35 + 30, m[1] + (e[1]-m[1])*.6, e[0] - 8, e[1] + (e[1] < m[1] ? 14 : -14)); g.stroke(); }
  }
  g.fillStyle = '#16191D'; g.fillRect(1120, 1000, 400, 10);
  g.font = '600 26px Archivo, Arial, sans-serif'; g.fillText('10 mm', 1278, 990);
  g.font = '500 22px "IBM Plex Mono", monospace'; g.fillStyle = '#3A3F45'; g.fillText('LEAF_SAMPLE · adaxial', 60, 70);
  return { c, B, A, U1, U2 };
}
function loadSample(){
  const { c, B, A, U1, U2 } = makeSample();
  resetSet();
  cur = newRecord({ img:c, isSample:true, thumb:makeThumb(c) });
  S.template = {
    id:'leaf-basic', name:'Leaf outline, basic set', version:'1.0', dimensions:2,
    description:'Example template for the sample image.',
    landmarks:[
      { id:'LM01', name:'Petiole base', description:'Proximal end of the petiole, where it was cut.' },
      { id:'LM02', name:'Blade base', description:'Where the two blade margins meet the petiole.' },
      { id:'LM03', name:'Apex', description:'Distal tip of the blade.' },
      { id:'LM04', name:'Widest point, upper', description:'Point on the upper margin farthest from the midrib.', bilateral_pair:'LM05' },
      { id:'LM05', name:'Widest point, lower', description:'Point on the lower margin farthest from the midrib.', bilateral_pair:'LM04' },
    ],
    curves:[
      { id:'C01', name:'Upper margin', start:'LM02', end:'LM03', n_points:10, path:'spline', spacing:'equal_arc_length' },
      { id:'C02', name:'Lower margin', start:'LM02', end:'LM03', n_points:10, path:'spline', spacing:'equal_arc_length' },
    ],
  };
  let wide = [0, 1e9]; for (let t = 0; t <= 1; t += .005){ const p = bez(B, U1, U2, A, t); if (p[1] < wide[1]) wide = p; }
  const ts = '2026-11-07T14:00:00Z';
  S.landmarks = [
    { id:'LM01', template_id:'LM01', status:'placed', position:[200.5, 578.5], placed_at:ts },
    { id:'LM02', template_id:'LM02', status:'placed', position:[380.5, 560.5], placed_at:ts },
    { id:'LM03', template_id:'LM03', status:'placed', position:[1399.5, 548.5], placed_at:ts },
    { id:'LM04', template_id:'LM04', status:'placed', position:[r6(wide[0]), r6(wide[1] + 1.5)], placed_at:ts },
  ];
  S.curves = [{ id:'C01', template_id:'C01', status:'placed', control_points:[.12, .3, .5, .7, .88].map(t => { const p = bez(B, U1, U2, A, t); return { position:[r6(p[0]), r6(p[1] + 1)] }; }), points:[] }];
  S.specimen = { id:'LEAF_SAMPLE', image:{ file:'sample_leaf.png', sha256:'', width:c.width, height:c.height,
    scale:{ value:0.025, units:'mm', method:'scale_bar', bar:{ points:[[1120.5, 1005.5], [1520.5, 1005.5]], length:10 } } } };
  S.sel = { kind:'lm', id:'LM05' };
  switchTo(cur); resize(); fit();
  c.toBlob(async b => { if (b && S.isSample){ S.specimen.image.sha256 = await C.sha256Hex(await b.arrayBuffer()); renderSide(); } }, 'image/png');
}

/* ---------- side panel tabs ---------- */
const tabs = [...document.querySelectorAll('#side [role="tab"]')];
function selectTab(tab){
  for (const t of tabs){
    const on = t === tab;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    $('#' + t.getAttribute('aria-controls')).hidden = !on;
  }
  if (tab.id === 't-template') tplEditor.render();
}
tabs.forEach(t => t.addEventListener('click', () => selectTab(t)));
$('#side [role="tablist"]').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = tabs.indexOf(document.activeElement); if (i < 0) return;
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  selectTab(next); next.focus(); e.preventDefault();
});

/* ---------- boot ---------- */
try { const op = localStorage.getItem('lmk2d:operator'); if (op) $('#opName').value = op; } catch {}
new ResizeObserver(() => resize()).observe(stage);
loadSample();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
document.documentElement.dataset.ready = '1';
})();

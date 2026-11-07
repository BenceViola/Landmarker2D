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

// Document state (shape defined in core.js) plus UI-only fields.
const S = Object.assign(C.newState(), {
  img:null, imgSha:null,
  sel:null, tool:'place', scaleDraft:[], scaleManual:false,
  view:{ s:1, ox:0, oy:0 }, labels:true, loupe:true,
  hover:null, hoverScr:null, pointerType:'mouse',
  isSample:false, docLoaded:false, warn:null,
});
window.__lmk = { S, C };   // used by the end-to-end tests

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
const nextTodo = () => C.nextTodo(S, S.sel);
const adhocEntries = () => C.adhocEntries(S);
const scaleObj = () => C.scaleOf(S);
const imgW = () => S.img ? S.img.width : (S.specimen.image?.width || 0);
const imgH = () => S.img ? S.img.height : (S.specimen.image?.height || 0);
const formOpts = () => ({ specimenId:$('#spId').value.trim(), notes:$('#spNotes').value.trim(), operator:$('#opName').value.trim() });
const specimenId = () => $('#spId').value.trim() || S.specimen.id || 'specimen';

let toastT;
function toast(msg, ms = 3200){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }

/* ---------- undo ---------- */
const undoStack = [];
const snap = () => JSON.stringify({ l:S.landmarks.map(stripGeom), c:S.curves.map(stripGeom), t:S.template, sc:S.specimen.image?.scale ?? null });
function stripGeom(o){ const r = {}; for (const k in o) if (k[0] !== '_') r[k] = o[k]; return r; }
function pushUndo(){ undoStack.push(snap()); if (undoStack.length > 150) undoStack.shift(); }
function undo(){
  const s = undoStack.pop(); if (!s){ toast('Nothing to undo'); return; }
  const o = JSON.parse(s); S.landmarks = o.l; S.curves = o.c; S.template = o.t;
  if (o.sc) S.specimen.image.scale = o.sc; else delete S.specimen.image.scale;
  if (S.sel && S.sel.kind !== 'adhoc' && !(S.sel.kind === 'lm' ? (tLm(S.sel.id) || lmEntry(S.sel.id)) : tCurve(S.sel.id))) S.sel = null;
  changed();
}
function changed(){ C.recomputeCurves(S); renderSide(); draw(); autosave(); }

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
    if (tLm(S.sel.id)){ const nx = nextTodo(); if (nx) S.sel = nx; }
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
function drawLoupe(w, h){
  if (!S.loupe || !S.img || !S.hover || !S.hoverScr || S.pointerType !== 'mouse' || gesture) return;
  const size = 150, z = Math.max(S.view.s * 3, 4), sw = size / z;
  const [hx, hy] = S.hover, [sx, sy] = S.hoverScr;
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
  if (S.provenance.operator) $('#opName').value = S.provenance.operator;
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
  updateHint();
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
  if (!S.sel || S.sel.kind === 'adhoc' || !(S.sel.kind === 'lm' ? (tLm(S.sel.id) || lmEntry(S.sel.id)) : tCurve(S.sel.id))) S.sel = C.nextTodo(S, null);
  changed();
}

/* ---------- documents and images ---------- */
function loadState(st){ Object.assign(S, st); }
function openDoc(d, srcName){
  const st = C.parseDoc(d, srcName);
  const keepImg = S.img && S.imgSha && st.specimen.image.sha256 === S.imgSha;
  loadState(st);
  S.isSample = false; S.docLoaded = true; S.warn = null;
  S.tool = 'place'; S.scaleDraft = []; undoStack.length = 0;
  if (!keepImg){ S.img = null; S.imgSha = null; }
  S.sel = C.nextTodo(S, null) || (items()[0] || null);
  setFields(); fit(); changed();
  toast(keepImg ? `Opened ${srcName}` : `Opened ${srcName}. Now open ${st.specimen.image.file || 'its image'}.`, 5000);
}
async function openImage(file){
  const buf = await file.arrayBuffer();
  const sha = await C.sha256Hex(buf);
  let bmp;
  try { bmp = await createImageBitmap(new Blob([buf], { type:file.type || 'image/jpeg' })); }
  catch { toast(`Couldn't read ${file.name}. Use JPG, PNG or WebP.`, 5000); return; }
  if (!S.img && S.docLoaded && !S.isSample){
    const im = S.specimen.image; const msgs = [];
    if (im.sha256 && sha && im.sha256 !== sha) msgs.push(`This image's checksum differs from the one in the file (${im.file}). If the image was edited or resized, every landmark may be shifted.`);
    if (im.width && (im.width !== bmp.width || im.height !== bmp.height)) msgs.push(`Size is ${bmp.width} × ${bmp.height}, the file says ${im.width} × ${im.height}.`);
    S.warn = msgs.join(' ') || null;
    S.img = bmp; S.imgSha = sha;
    S.specimen.image = { ...im, file:file.name, sha256:sha, width:bmp.width, height:bmp.height };
    fit(); changed(); toast(`Opened ${file.name}`); return;
  }
  const keepTemplate = S.isSample ? C.emptyTemplate() : S.template;
  loadState(C.newState());
  S.template = keepTemplate;
  S.img = bmp; S.imgSha = sha;
  S.specimen = { id:C.stem(file.name), image:{ file:file.name, sha256:sha, width:bmp.width, height:bmp.height } };
  S.isSample = false; S.docLoaded = true; S.warn = null;
  S.tool = 'place'; S.scaleDraft = []; undoStack.length = 0;
  let restored = false;
  try {
    const saved = sha && localStorage.getItem('lmk2d:' + sha);
    if (saved){
      const st = C.parseDoc(JSON.parse(saved), 'Saved work');
      st.specimen.image = { ...st.specimen.image, file:file.name };
      loadState(st); restored = true;
    }
  } catch {}
  S.sel = C.nextTodo(S, null) || items()[0] || null;
  setFields(); fit(); changed();
  toast(restored ? `Restored your unsaved work on ${file.name} from this browser` : `Opened ${file.name}`, 4000);
}
async function openJsonFile(file){
  let d;
  try { d = JSON.parse(await file.text()); } catch { toast(`${file.name} is not valid JSON`, 4000); return; }
  try {
    const kind = C.sniffJson(d);
    if (kind === 'doc') openDoc(d, file.name);
    else if (kind === 'template'){ applyTemplate(C.checkTemplate(d)); toast(`Loaded template ${d.name || d.id || file.name}`); }
    else throw new Error(`${file.name} is neither a landmark file nor a template`);
  } catch (e){ toast(e.message, 6000); }
}
let saveT;
function autosave(){
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    if (S.isSample || !S.imgSha) return;
    try {
      localStorage.setItem('lmk2d:' + S.imgSha, JSON.stringify(C.buildDoc(S, formOpts())));
      $('#sSave').textContent = 'kept in this browser ' + new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    } catch {}
  }, 500);
}

/* ---------- export ---------- */
function exportNote(){ const n = C.notDoneCount(C.exportRows(S)); return n ? ` ${n} point${n === 1 ? ' was' : 's were'} not done and ${n === 1 ? 'is' : 'are'} written as missing.` : ''; }
function exportTPS(){ if (!imgW()){ toast('Open an image first'); return; } saveFile(`${specimenId()}.tps`, C.toTPS(S, specimenId()), exportNote()); }
function exportCSV(){ if (!imgW()){ toast('Open an image first'); return; } saveFile(`${specimenId()}.csv`, C.toCSV(S, specimenId()), exportNote()); }

/* ---------- saving files ----------
 * Inside a claude.ai artifact, downloads go through the `downloads` capability
 * (which only allows some extensions, so .tps becomes .tps.txt there).
 * Anywhere else (GitHub Pages, a local copy) a normal download link is used. */
let dlP = null;
async function saveFile(name, text, note = ''){
  const c = window.claude;
  if (c && typeof c.use === 'function'){
    if (!dlP) dlP = Promise.resolve(c.use('downloads')).catch(() => null);
    const dl = await dlP;
    if (dl){
      const fname = /\.(json|csv|txt)$/i.test(name) ? name : name + '.txt';
      try { await dl.save({ filename:fname, data:text }); toast((fname === name ? `Saved ${name}.` : `Saved ${fname}. Rename it to ${name}.`) + note, 6000); }
      catch (e){ if (e && e.code === 'declined') return; if (e && e.code === 'rate_limited'){ toast('A save prompt is already open'); return; } showText(name, text); }
      return;
    }
    showText(name, text); return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type:'text/plain' }));
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
  else if (act === 'tpl-edit'){ $('#tplText').value = C.tplToText(S.template); $('#tplErr').textContent = ''; $('#dTpl').showModal(); }
  else if (act === 'tpl-load') $('#fTpl').click();
  else if (act === 'tpl-save'){ const t = C.clone(S.template); t.dimensions = 2; saveFile(`${t.id || 'template'}.template.json`, JSON.stringify(t, null, 2) + '\n'); }
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
  else if (id === 'spId'){ S.specimen.id = e.target.value.trim(); autosave(); }
  else if (id === 'spNotes'){ S.specimen.notes = e.target.value.trim(); autosave(); }
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
$('#fImg').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openImage(f); };
$('#fDoc').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openJsonFile(f); };
$('#fTpl').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  f.text().then(txt => {
    try { const d = JSON.parse(txt); applyTemplate(C.checkTemplate(C.sniffJson(d) === 'doc' ? d.template : d)); toast('Template loaded'); }
    catch (err){ toast(err.message || 'Not a template file', 6000); }
  }); };
$('#bSave').onclick = () => {
  if (!imgW()){ toast('Open an image first'); return; }
  const d = C.buildDoc(S, formOpts()); saveFile(`${d.specimen.id}.lmk.json`, JSON.stringify(d, null, 2) + '\n');
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
  const js = files.filter(f => /\.json$/i.test(f.name)), imgs = files.filter(f => /^image\//.test(f.type));
  for (const f of js) await openJsonFile(f);
  if (imgs[0]) await openImage(imgs[0]);
});

document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select,dialog')) return;
  if (e.key === ' '){ spaceDown = true; e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z'){ e.preventDefault(); undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'escape'){ if (S.tool !== 'place') cancelScale(); return; }
  if (k === 'n' || e.key === 'Tab'){ e.preventDefault(); const n = nextTodo(); if (n){ S.sel = n; renderSide(); draw(); } else toast('Every template point is done'); return; }
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
  loadState(C.newState());
  S.img = c; S.isSample = true; S.docLoaded = true;
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
  setFields(); C.recomputeCurves(S); resize(); fit(); renderSide();
  c.toBlob(async b => { if (b && S.isSample){ S.specimen.image.sha256 = await C.sha256Hex(await b.arrayBuffer()); renderSide(); } }, 'image/png');
}

/* ---------- boot ---------- */
try { const op = localStorage.getItem('lmk2d:operator'); if (op) $('#opName').value = op; } catch {}
new ResizeObserver(() => resize()).observe(stage);
loadSample();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
document.documentElement.dataset.ready = '1';
})();

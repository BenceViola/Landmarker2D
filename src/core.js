/*
 * landmarker2D core: pure logic with no DOM access, so it runs in the
 * browser (as window.LmkCore) and in Node (require) for the tests.
 *
 * A "state" object has the shape:
 *   { raw, specimen, template, landmarks, curves, provenance }
 * following the landmark-json format specification (2D data, v0.2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LmkCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOFTWARE = 'landmarker-2d';
  const SOFTWARE_VERSION = '0.1.0';
  const FORMAT_VERSION = '0.2.0';
  const STATUSES = ['placed', 'estimated', 'missing'];
  const UNITS = ['mm', 'cm', 'um', 'm'];

  /* ---------- small helpers ---------- */
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const fmt = v => String(r6(v));
  const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const stem = n => n.replace(/\.[^.]+$/, '').replace(/\.lmk$/, '');
  const clone = o => (o === undefined ? o : JSON.parse(JSON.stringify(o)));

  async function sha256Hex(buf) {
    try {
      const subtle = (globalThis.crypto || {}).subtle;
      const h = await subtle.digest('SHA-256', buf);
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return ''; }
  }

  const emptyTemplate = () => ({ id: 'untitled', name: 'Untitled template', version: '1.0', dimensions: 2, landmarks: [], curves: [] });

  function newState() {
    return {
      raw: {},
      specimen: { id: '', image: { file: '', sha256: '', width: 0, height: 0 } },
      template: emptyTemplate(),
      landmarks: [], curves: [], provenance: {},
    };
  }

  /* ---------- lookups ---------- */
  const tLm = (s, id) => (s.template.landmarks || []).find(l => l.id === id);
  const tCurve = (s, id) => (s.template.curves || []).find(c => c.id === id);
  const lmEntry = (s, id) => s.landmarks.find(l => l.id === id);
  const curveEntry = (s, id) => s.curves.find(c => c.id === id);
  const scaleOf = s => (s.specimen.image && s.specimen.image.scale) || null;

  /* ---------- items and progress ---------- */
  function items(s) {
    const a = [];
    (s.template.landmarks || []).forEach(t => a.push({ kind: 'lm', id: t.id }));
    (s.template.curves || []).forEach(t => a.push({ kind: 'curve', id: t.id }));
    return a;
  }
  const adhocEntries = s => s.landmarks.filter(l => !l.template_id || !tLm(s, l.template_id));

  /** 'todo' | 'partial' | 'placed' | 'estimated' | 'missing' */
  function itemState(s, it) {
    if (it.kind === 'lm') {
      const e = lmEntry(s, it.id);
      if (!e || !e.status) return 'todo';
      if (e.status === 'missing') return 'missing';
      if (!e.position) return 'todo';
      return e.status;
    }
    const c = curveEntry(s, it.id);
    if (!c) return 'todo';
    if (c.status === 'missing') return 'missing';
    if (c.points && c.points.length) return c.status === 'estimated' ? 'estimated' : 'placed';
    return c.control_points && c.control_points.length ? 'partial' : 'todo';
  }
  const isDone = (s, it) => ['placed', 'estimated', 'missing'].includes(itemState(s, it));

  /** Next item after `sel` that is not done, wrapping around; null when all are done. */
  function nextTodo(s, sel) {
    const a = items(s);
    if (!a.length) return null;
    const i = sel ? a.findIndex(x => x.kind === sel.kind && x.id === sel.id) : -1;
    for (let k = 1; k <= a.length; k++) {
      const it = a[(i + k + a.length) % a.length];
      if (!isDone(s, it)) return it;
    }
    return null;
  }

  /* ---------- curves ---------- */
  const lerpT = (p, q, ta, tb, t) => {
    const d = tb - ta, u = (tb - t) / d, v = (t - ta) / d;
    return [p[0] * u + q[0] * v, p[1] * u + q[1] * v];
  };
  /** One centripetal Catmull-Rom segment from p1 to p2 (excluding p2). */
  function crSeg(p0, p1, p2, p3, steps, out) {
    const k = (p, q) => Math.max(Math.sqrt(dist(p, q)), 1e-4);
    const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
    for (let i = 0; i < steps; i++) {
      const t = t1 + (t2 - t1) * i / steps;
      const A1 = lerpT(p0, p1, t0, t1, t), A2 = lerpT(p1, p2, t1, t2, t), A3 = lerpT(p2, p3, t2, t3, t);
      const B1 = lerpT(A1, A2, t0, t2, t), B2 = lerpT(A2, A3, t1, t3, t);
      out.push(lerpT(B1, B2, t1, t2, t));
    }
  }
  /** Dense polyline through the points: straight segments, or a spline through them. */
  function densePath(P, path, closed, steps = 24) {
    const n = P.length;
    if (path !== 'spline' || n < 3) return closed ? [...P, P[0]] : P.slice();
    const out = [];
    if (closed) {
      for (let i = 0; i < n; i++) crSeg(P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n], steps, out);
      out.push(P[0]);
    } else {
      const ext = i => i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]]
        : i >= n ? [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]] : P[i];
      for (let i = 0; i < n - 1; i++) crSeg(ext(i - 1), P[i], P[i + 1], ext(i + 2), steps, out);
      out.push(P[n - 1]);
    }
    return out;
  }
  /**
   * n points at equal arc length along dense path D.
   * a, b = 1 when the start / end is anchored on a landmark (then that end is
   * excluded from the n points). Closed paths give n points around the loop.
   */
  function resample(D, n, a, b, closed) {
    const cum = [0];
    for (let i = 1; i < D.length; i++) cum.push(cum[i - 1] + dist(D[i - 1], D[i]));
    const L = cum[cum.length - 1];
    if (!(L > 0) || n < 1) return { L: L || 0, pts: [] };
    let at;
    if (closed) at = k => k * L / n;
    else {
      const den = n - 1 + a + b;
      at = den > 0 ? (k => (k + a) * L / den) : (() => L / 2);
    }
    const pts = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
      const d = at(k);
      while (j < cum.length - 1 && cum[j] < d) j++;
      const seg = cum[j] - cum[j - 1], u = seg > 0 ? (d - cum[j - 1]) / seg : 0;
      pts.push([D[j - 1][0] + (D[j][0] - D[j - 1][0]) * u, D[j - 1][1] + (D[j][1] - D[j - 1][1]) * u]);
    }
    return { L, pts };
  }
  function curveGeom(s, c, t) {
    const P = (c.control_points || []).map(p => p.position);
    let a = 0, b = 0, err = null;
    if (!t.closed) {
      if (t.start) {
        const e = lmEntry(s, t.start);
        if (e && e.position && e.status !== 'missing') { P.unshift(e.position); a = 1; }
        else err = `Place ${t.start} first; the curve starts there.`;
      }
      if (t.end) {
        const e = lmEntry(s, t.end);
        if (e && e.position && e.status !== 'missing') { P.push(e.position); b = 1; }
        else err = err || `Place ${t.end} first; the curve ends there.`;
      }
    }
    const path = t.path || 'polyline';
    if (err || P.length < 2) return { ctrl: P, dense: P.length >= 2 ? densePath(P, path, !!t.closed) : [], pts: [], L: 0, err, a, b };
    const D = densePath(P, path, !!t.closed);
    const { L, pts } = resample(D, t.n_points != null ? t.n_points : 10, a, b, !!t.closed);
    return { ctrl: P, dense: D, pts, L, err: null, a, b };
  }
  /** Recompute every curve's semilandmarks; geometry is kept in the private `_geom` field. */
  function recomputeCurves(s) {
    for (const c of s.curves) {
      const t = tCurve(s, c.template_id);
      if (!t) { c._geom = null; continue; }
      const g = curveGeom(s, c, t);
      c._geom = g;
      if (c.status === 'missing') { c.points = []; continue; }
      c.points = g.pts.map(p => ({ position: [r6(p[0]), r6(p[1])] }));
      c.length = r6(g.L);
      c.sampling = { path: t.path || 'polyline', spacing: t.spacing || 'equal_arc_length', n_points: t.n_points != null ? t.n_points : 10 };
      if (!c.status) c.status = 'placed';
    }
  }

  /* ---------- placing and editing ---------- */
  function placeLm(s, id, p, ts) {
    let e = lmEntry(s, id);
    if (!e) { e = { id, template_id: tLm(s, id) ? id : null, status: 'placed', position: null }; s.landmarks.push(e); }
    e.position = [r6(p[0]), r6(p[1])];
    if (e.status !== 'estimated') e.status = 'placed';
    e.placed_at = ts || nowIso();
    return e;
  }
  function ensureCurve(s, id) {
    let c = curveEntry(s, id);
    if (!c) { c = { id, template_id: id, status: 'placed', control_points: [], points: [] }; s.curves.push(c); }
    return c;
  }
  function newAdhocId(s) {
    let i = 1;
    while (lmEntry(s, 'AH' + String(i).padStart(2, '0'))) i++;
    return 'AH' + String(i).padStart(2, '0');
  }
  function addAdhoc(s, p, ts) {
    const id = newAdhocId(s);
    const e = { id, template_id: null, label: 'Ad hoc ' + String(parseInt(id.slice(2), 10)), status: 'placed', position: [r6(p[0]), r6(p[1])], placed_at: ts || nowIso() };
    s.landmarks.push(e);
    return e;
  }
  /**
   * Set the status of a landmark or curve. Returns 'needs_position' when
   * "placed" was chosen for a landmark that has no position yet.
   */
  function setStatus(s, sel, st) {
    if (!STATUSES.includes(st)) throw new Error('Unknown status ' + st);
    if (sel.kind === 'lm') {
      let e = lmEntry(s, sel.id);
      if (!e) { e = { id: sel.id, template_id: tLm(s, sel.id) ? sel.id : null, status: st, position: null }; s.landmarks.push(e); }
      let result = 'ok';
      if (st === 'missing') { e.status = 'missing'; e.position = null; }
      else if (st === 'placed' && !e.position) { delete e.status; result = 'needs_position'; }
      else e.status = st;
      if (!e.status && !e.position && !e.note) s.landmarks = s.landmarks.filter(x => x !== e);
      return result;
    }
    const c = ensureCurve(s, sel.id);
    c.status = st;
    return 'ok';
  }
  function clearItem(s, sel) {
    if (sel.kind === 'lm') s.landmarks = s.landmarks.filter(e => e.id !== sel.id);
    else if (sel.kind === 'curve') s.curves = s.curves.filter(c => c.id !== sel.id);
  }

  /* ---------- scale ---------- */
  function scaleFromBar(points, length, units) {
    const px = dist(points[0], points[1]);
    if (!(length > 0)) throw new Error('Enter a length greater than zero');
    if (!(px > 0)) throw new Error('The two ends of the bar are at the same place');
    if (!UNITS.includes(units)) throw new Error('Unknown units ' + units);
    return { value: r6(length / px), units, method: 'scale_bar', bar: { points: points.map(p => [r6(p[0]), r6(p[1])]), length } };
  }

  /* ---------- templates ---------- */
  function tplToText(t) {
    const L = [`# id: ${t.id || ''}`, `# name: ${t.name || ''}`, `# version: ${t.version || ''}`];
    if (t.description) L.push(`# description: ${t.description}`);
    if (t.author) L.push(`# author: ${t.author}`);
    L.push('');
    (t.landmarks || []).forEach(l => {
      let s = `${l.id} | ${l.name || ''}`;
      if (l.description) s += ` | ${l.description}`;
      if (l.bilateral_pair) s += ` | pair=${l.bilateral_pair}`;
      L.push(s);
    });
    if ((t.curves || []).length) L.push('');
    (t.curves || []).forEach(c => {
      const o = [];
      if (c.start) o.push('start=' + c.start);
      if (c.end) o.push('end=' + c.end);
      o.push('n=' + (c.n_points != null ? c.n_points : 10));
      o.push('path=' + (c.path || 'polyline'));
      if (c.closed) o.push('closed');
      L.push(`curve ${c.id} | ${c.name || ''} | ${o.join(' ')}${c.description ? ' | ' + c.description : ''}`);
    });
    return L.join('\n');
  }
  /** Parse the line-based template text. Fields the text format doesn't show are kept from `base`. */
  function textToTpl(txt, base) {
    base = base || {};
    const t = Object.assign({}, clone(base), { dimensions: 2, landmarks: [], curves: [] });
    delete t.export_order;
    const keep = (arr, id, known) => {
      const b = (arr || []).find(x => x.id === id), o = {};
      if (b) for (const k in b) if (!known.includes(k)) o[k] = clone(b[k]);
      return o;
    };
    txt.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('#')) {
        const m = line.match(/^#\s*(\w+)\s*:\s*(.*)$/);
        if (m && ['id', 'name', 'version', 'description', 'author'].includes(m[1])) {
          if (m[2]) t[m[1]] = m[2]; else delete t[m[1]];
        }
        return;
      }
      const parts = line.split('|').map(x => x.trim());
      if (/^curve\s+/i.test(parts[0])) {
        const id = parts[0].replace(/^curve\s+/i, '').trim();
        const c = Object.assign(keep(base.curves, id, ['id', 'name', 'description', 'start', 'end', 'n_points', 'path', 'closed', 'spacing']),
          { id, name: parts[1] || id, n_points: 10, path: 'polyline', spacing: 'equal_arc_length' });
        (parts[2] || '').split(/\s+/).filter(Boolean).forEach(tok => {
          const [k, v] = tok.split('=');
          if (k === 'start') c.start = v;
          else if (k === 'end') c.end = v;
          else if (k === 'n' || k === 'n_points') c.n_points = parseInt(v, 10);
          else if (k === 'path') c.path = v;
          else if (k === 'closed') c.closed = true;
          else throw new Error(`Line ${i + 1}: unknown curve option "${tok}"`);
        });
        if (!(c.n_points >= 1)) throw new Error(`Line ${i + 1}: n must be 1 or more`);
        if (!['polyline', 'spline'].includes(c.path)) throw new Error(`Line ${i + 1}: path must be polyline or spline`);
        if (parts[3]) c.description = parts[3];
        t.curves.push(c);
      } else {
        const id = parts[0];
        const l = Object.assign(keep(base.landmarks, id, ['id', 'name', 'description', 'bilateral_pair']), { id, name: parts[1] || id });
        parts.slice(2).forEach(p => {
          const m = p.match(/^pair\s*=\s*(\S+)$/);
          if (m) l.bilateral_pair = m[1]; else if (p) l.description = p;
        });
        t.landmarks.push(l);
      }
    });
    const ids = [...t.landmarks.map(l => l.id), ...t.curves.map(c => c.id)];
    for (const id of ids) if (!id || /\s/.test(id)) throw new Error(`Ids can't be empty or contain spaces ("${id}")`);
    const dup = ids.find((x, i) => ids.indexOf(x) !== i);
    if (dup) throw new Error(`Id ${dup} is used twice`);
    for (const c of t.curves) for (const k of ['start', 'end']) {
      if (c[k] && !t.landmarks.some(l => l.id === c[k])) throw new Error(`Curve ${c.id}: ${k} ${c[k]} is not a landmark in this template`);
    }
    for (const l of t.landmarks) {
      if (l.bilateral_pair && !t.landmarks.some(x => x.id === l.bilateral_pair)) throw new Error(`${l.id}: pair ${l.bilateral_pair} is not in this template`);
    }
    return t;
  }
  function checkTemplate(t) {
    if (!t || typeof t !== 'object') throw new Error('No template found in this file');
    if (t.ref) throw new Error('This file references an external template. Embed the template to use it here.');
    if (!Array.isArray(t.landmarks)) throw new Error('The template has no landmarks list');
    const dims = t.dimensions != null ? t.dimensions : 3;
    if (dims !== 2) throw new Error(`This template is for ${dims}D data. Add "dimensions": 2 to use it on images.`);
    return t;
  }
  /** Use a new template: landmarks it no longer lists become ad hoc points; curves it drops are removed. */
  function applyTemplate(s, t) {
    s.template = t;
    for (const e of s.landmarks) if (e.template_id && !tLm(s, e.template_id)) { e.template_id = null; e.label = e.label || e.id; }
    s.curves = s.curves.filter(c => tCurve(s, c.template_id));
  }

  /* ---------- documents ---------- */
  function sortedEntries(s) {
    const order = new Map(items(s).map((x, i) => [x.id, i]));
    const key = e => order.has(e.template_id) ? order.get(e.template_id) : 1e6;
    return s.landmarks.slice().sort((a, b) => key(a) - key(b));
  }
  const stripPriv = o => { const r = {}; for (const k in o) if (k[0] !== '_') r[k] = clone(o[k]); return r; };

  /**
   * Build the landmark-json document. Unknown fields from the opened file
   * (state.raw) are kept. opts: { specimenId, notes, operator, now }.
   */
  function buildDoc(s, opts) {
    opts = opts || {};
    const now = opts.now || nowIso();
    const d = clone(s.raw || {});
    d.format = 'landmark-json';
    d.version = FORMAT_VERSION;
    const sp = clone(s.specimen);
    delete sp.mesh;
    if (opts.specimenId !== undefined) sp.id = opts.specimenId;
    sp.id = sp.id || 'specimen';
    if (opts.notes !== undefined) { if (opts.notes) sp.notes = opts.notes; else delete sp.notes; }
    d.specimen = sp;
    d.template = clone(s.template);
    d.landmarks = sortedEntries(s)
      .filter(e => STATUSES.includes(e.status))
      .map(e => { const o = stripPriv(e); if (o.position) o.position = o.position.map(r6); if (o.status === 'missing') o.position = null; return o; });
    const curves = s.curves.map(stripPriv);
    if (curves.length || d.curves) d.curves = curves;
    const prov = Object.assign({}, (s.raw && s.raw.provenance) || {}, { software: SOFTWARE, software_version: SOFTWARE_VERSION });
    const op = opts.operator !== undefined ? opts.operator : (s.provenance && s.provenance.operator);
    if (op) prov.operator = op;
    prov.created = prov.created || now;
    prov.modified = now;
    d.provenance = prov;
    return d;
  }
  /** Validate a parsed .lmk.json and return the state it describes. Throws with a readable message. */
  function parseDoc(d, srcName) {
    srcName = srcName || 'This file';
    if (!d || d.format !== 'landmark-json') throw new Error(`${srcName} is not a landmark-json file`);
    const major = parseInt(String(d.version || '0').split('.')[0], 10);
    if (major > 0) throw new Error(`${srcName} uses format ${d.version}, which is newer than this app understands`);
    if (!d.specimen || d.specimen.mesh) throw new Error(`${srcName} holds 3D mesh data. Open it in the 3D app.`);
    if (!d.specimen.image) throw new Error(`${srcName} has no image source`);
    checkTemplate(d.template);
    return {
      raw: clone(d),
      specimen: clone(d.specimen),
      template: clone(d.template),
      landmarks: clone(d.landmarks || []),
      curves: clone(d.curves || []),
      provenance: clone(d.provenance || {}),
    };
  }
  /** What a .json file is: 'doc', 'template' or null. */
  function sniffJson(d) {
    if (d && d.format === 'landmark-json') return 'doc';
    if (d && Array.isArray(d.landmarks) && !d.format) return 'template';
    return null;
  }

  /* ---------- exports ---------- */
  function exportRows(s) {
    const T = s.template, rows = [];
    const lmIds = (T.landmarks || []).map(l => l.id), cIds = (T.curves || []).map(c => c.id);
    const order = Array.isArray(T.export_order) && T.export_order.length ? T.export_order.slice() : [...lmIds, ...cIds];
    for (const id of [...lmIds, ...cIds]) if (!order.includes(id)) order.push(id);
    for (const id of order) {
      if (tLm(s, id)) {
        const e = lmEntry(s, id);
        const done = e && (e.position || e.status === 'missing') && STATUSES.includes(e.status);
        rows.push({ point: id, template_id: id, label: tLm(s, id).name, type: 'landmark', curve: '', index: '',
          pos: e && e.status !== 'missing' && e.position ? e.position : null, status: done ? e.status : 'not_done' });
      } else if (tCurve(s, id)) {
        const t = tCurve(s, id), c = curveEntry(s, id), n = t.n_points != null ? t.n_points : 10;
        const ok = c && c.status !== 'missing' && c.points && c.points.length === n;
        for (let k = 0; k < n; k++) {
          rows.push({ point: `${id}_${String(k + 1).padStart(2, '0')}`, template_id: id, label: t.name, type: 'curve', curve: id, index: k + 1,
            pos: ok ? c.points[k].position : null, status: ok ? (c.status || 'placed') : (c && c.status === 'missing' ? 'missing' : 'not_done') });
        }
      }
    }
    for (const e of adhocEntries(s)) {
      rows.push({ point: e.id, template_id: '', label: e.label || '', type: 'adhoc', curve: '', index: '',
        pos: e.status !== 'missing' ? (e.position || null) : null,
        status: e.position || e.status === 'missing' ? (e.status || 'placed') : 'not_done' });
    }
    return rows;
  }
  const notDoneCount = rows => rows.filter(r => r.status === 'not_done').length;

  /** tpsDig-style TPS: y flipped to point up, missing written as -999 -999. */
  function toTPS(s, specimenId) {
    const rows = exportRows(s), H = s.specimen.image.height, sc = scaleOf(s);
    const L = [`LM=${rows.length}`];
    for (const r of rows) L.push(r.pos ? `${fmt(r.pos[0])} ${fmt(H - r.pos[1])}` : '-999 -999');
    L.push(`IMAGE=${s.specimen.image.file}`);
    L.push(`ID=${specimenId || s.specimen.id}`);
    if (sc) L.push(`SCALE=${fmt(sc.value)}`);
    return L.join('\n') + '\n';
  }
  /** CSV in image orientation (y down), in scale units when a scale is set, else pixels. */
  function toCSV(s, specimenId) {
    const rows = exportRows(s), sc = scaleOf(s), units = sc ? sc.units : 'px', k = sc ? sc.value : 1;
    const id = specimenId || s.specimen.id;
    const q = v => { const x = String(v == null ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const L = ['specimen_id,image,point,template_id,label,type,curve,index,x,y,units,status'];
    for (const r of rows) {
      L.push([id, s.specimen.image.file, r.point, r.template_id, r.label, r.type, r.curve, r.index,
        r.pos ? fmt(r.pos[0] * k) : 'NA', r.pos ? fmt(r.pos[1] * k) : 'NA', units, r.status].map(q).join(','));
    }
    return L.join('\n') + '\n';
  }

  return {
    SOFTWARE, SOFTWARE_VERSION, FORMAT_VERSION, STATUSES, UNITS,
    r6, fmt, dist, nowIso, stem, clone, sha256Hex, emptyTemplate, newState,
    tLm, tCurve, lmEntry, curveEntry, scaleOf,
    items, adhocEntries, itemState, isDone, nextTodo,
    densePath, resample, curveGeom, recomputeCurves,
    placeLm, ensureCurve, newAdhocId, addAdhoc, setStatus, clearItem,
    scaleFromBar,
    tplToText, textToTpl, checkTemplate, applyTemplate,
    sortedEntries, buildDoc, parseDoc, sniffJson,
    exportRows, notDoneCount, toTPS, toCSV,
  };
});

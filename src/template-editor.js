/*
 * The Template tab: the landmarking protocol. Name the template, add
 * landmarks (one at a time or a pasted list), rename them, write placement
 * instructions, set bilateral pairs, change the order they are placed and
 * exported in, and set up curves.
 *
 * Modelled on Landmarker3D's js/template-editor.js so both apps work the same.
 * Edits are applied when a field is left (change event), so each one is a
 * single undo step. An ID is locked once it has data, as the spec requires.
 *
 * ctx = { S, C, mutate(fn), afterAdd(kind, id), loadTemplate(), saveTemplate(), editAsText() }
 *   mutate(fn) runs fn, records an undo step if anything changed, re-renders,
 *   and returns fn's result.
 */
(function (root) {
'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = id => encodeURIComponent(id).replace(/%/g, '_');

class TemplateEditor {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.errors = new Map();   // 'meta' | 'lm:ID' | 'curve:ID' -> message
    this.open = new Set();     // 'lm:ID' | 'curve:ID' whose details are expanded
    this.confirming = null;    // 'lm:ID' | 'curve:ID' | '*new*'

    el.addEventListener('change', e => this._onChange(e));
    el.addEventListener('click', e => this._onClick(e));
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'tpl-new-name') { e.preventDefault(); this._addOne(); }
      else if (e.target.id === 'tpl-new-curve') { e.preventDefault(); this._addCurve(); }
    });
    el.addEventListener('toggle', e => {
      const row = e.target.closest && e.target.closest('[data-row]');
      if (!row || !e.target.matches('details')) return;
      const k = `${row.dataset.kind}:${row.dataset.row}`;
      if (e.target.open) this.open.add(k); else this.open.delete(k);
    }, true);
  }

  get visible() { return !this.el.closest('[hidden]'); }

  // Rendering waits a frame, so a Tab out of a field moves focus before the
  // inputs are rebuilt, and several changes in a row render once.
  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }

  render() {
    const { S } = this.ctx;
    const t = S.template;
    const active = document.activeElement;
    const focusId = active && this.el.contains(active) ? active.id : null;
    const caret = focusId && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const keep = id => (this.el.querySelector('#' + id) || {}).value || '';
    const pending = keep('tpl-new-name'), pendingCurve = keep('tpl-new-curve'), bulk = keep('tpl-bulk');
    const bulkOpen = !!(this.el.querySelector('#tpl-bulk-box') || {}).open;

    const lms = t.landmarks || [], curves = t.curves || [];
    const metaErr = this.errors.get('meta');

    this.el.innerHTML = `
      <div class="tpl-meta">
        <label class="field-stack">Template name
          <input id="tpl-f-name" type="text" value="${esc(t.name)}" data-field="name">
        </label>
        <div class="tpl-meta-row">
          <label class="field-stack">Template ID
            <input id="tpl-f-id" type="text" class="mono" value="${esc(t.id)}" data-field="id" spellcheck="false">
          </label>
          <label class="field-stack">Version
            <input id="tpl-f-version" type="text" class="mono" value="${esc(t.version)}" data-field="version" spellcheck="false">
          </label>
        </div>
        ${metaErr ? `<p class="tpl-err" role="alert">${esc(metaErr)}</p>` : ''}
        <p class="hint"><span class="mono">dimensions: 2</span> · landmarks on images. Templates for 3D meshes can’t be used here.</p>
      </div>

      <div class="tpl-section">
        <div class="eyebrow">Landmarks</div>
        <p class="hint">${lms.length
          ? `${lms.length} landmark${lms.length === 1 ? '' : 's'}, placed and exported in this order.`
          : 'No landmarks yet. Add the first one below.'}</p>
        ${lms.length ? `<ol class="tpl-list" id="tpl-lm-list">${lms.map((d, i) => this._lmRow(d, i, lms)).join('')}</ol>` : ''}
        <div class="tpl-add">
          <label class="visually-hidden" for="tpl-new-name">New landmark name</label>
          <input id="tpl-new-name" type="text" placeholder="New landmark, e.g. Nasion" value="${esc(pending)}">
          <button type="button" class="btn sm" data-act="add">Add</button>
        </div>
        <details id="tpl-bulk-box" class="tpl-bulk"${bulkOpen ? ' open' : ''}>
          <summary>Add several at once</summary>
          <label class="visually-hidden" for="tpl-bulk">Landmark names, one per line</label>
          <textarea id="tpl-bulk" rows="5" placeholder="One name per line&#10;Nasion&#10;Bregma&#10;Lambda">${esc(bulk)}</textarea>
          <button type="button" class="btn sm" data-act="add-bulk">Add all</button>
        </details>
      </div>

      <div class="tpl-section">
        <div class="eyebrow">Curves</div>
        <p class="hint">${curves.length
          ? `Semilandmarks spaced evenly along an outline. Exported after the landmarks, in this order.`
          : 'Optional. A curve gives a set number of semilandmarks spaced evenly along an outline, such as a margin or a suture.'}</p>
        ${curves.length ? `<ol class="tpl-list" id="tpl-curve-list">${curves.map((c, i) => this._curveRow(c, i, curves, lms)).join('')}</ol>` : ''}
        <div class="tpl-add">
          <label class="visually-hidden" for="tpl-new-curve">New curve name</label>
          <input id="tpl-new-curve" type="text" placeholder="New curve, e.g. Upper margin" value="${esc(pendingCurve)}">
          <button type="button" class="btn sm" data-act="add-curve">Add</button>
        </div>
      </div>

      ${Array.isArray(t.export_order) && t.export_order.length
        ? `<p class="hint tpl-note">This template sets its own export order. Moving an item replaces it with the order shown here.</p>` : ''}

      <div class="tpl-section">
        <div class="eyebrow">Template file</div>
        <p class="hint">Save the template and share it, so every student places the same landmarks.</p>
        <div class="inline">
          <button type="button" class="btn sm" data-act="tpl-save">Save template file</button>
          <button type="button" class="btn sm" data-act="tpl-load">Open template file…</button>
          <button type="button" class="btn sm" data-act="tpl-text">Edit as text…</button>
        </div>
      </div>

      <div class="tpl-danger">
        ${this.confirming === '*new*'
          ? `<p class="confirm-text">Start an empty template? This removes all ${lms.length} landmarks${curves.length ? ` and ${curves.length} curve${curves.length === 1 ? '' : 's'}` : ''} and every placed point${S._set && S._set.specimens.length > 1 ? ` on all ${S._set.specimens.length} specimens` : ''}. You can undo it.</p>
             <div class="confirm-actions">
               <button type="button" class="btn sm danger" data-act="new-yes">Start empty template</button>
               <button type="button" class="btn sm" data-act="cancel">Cancel</button>
             </div>`
          : `<button type="button" class="btn quiet" data-act="new">Start a new empty template…</button>`}
      </div>`;

    if (focusId) {
      const el = this.el.querySelector('#' + CSS.escape(focusId));
      if (el) {
        el.focus();
        if (caret !== null && typeof el.setSelectionRange === 'function') {
          try { el.setSelectionRange(caret, caret); } catch (e) { /* not a text field */ }
        }
      }
    }
  }

  _btns(kind, d, i, n) {
    return `<div class="tpl-btns">
      <button type="button" class="icon-btn" data-act="up" aria-label="Move ${esc(d.id)} up"${i === 0 ? ' disabled' : ''}>↑</button>
      <button type="button" class="icon-btn" data-act="down" aria-label="Move ${esc(d.id)} down"${i === n - 1 ? ' disabled' : ''}>↓</button>
      <button type="button" class="icon-btn" data-act="del" aria-label="Delete ${esc(d.id)}">×</button>
    </div>`;
  }

  _confirm(kind, d) {
    if (this.confirming !== `${kind}:${d.id}`) return '';
    const { S, C } = this.ctx;
    const n = C.specimensWith(S, kind, d.id);
    const what = !n ? ''
      : kind === 'curve' ? ` and the points clicked on it${n > 1 ? ` on ${n} specimens` : ''}`
      : n > 1 ? ` and its placed points on ${n} specimens` : ' and its placed point';
    return `<div class="tpl-confirm">
      <p class="confirm-text">Delete ${esc(d.id)} ${esc(d.name)}${what}?</p>
      <div class="confirm-actions">
        <button type="button" class="btn sm danger" data-act="del-yes">Delete</button>
        <button type="button" class="btn sm" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  }

  _lmRow(d, i, lms) {
    const { S, C } = this.ctx;
    const hasData = C.specimensWith(S, 'lm', d.id) > 0;
    const k = key(d.id);
    const err = this.errors.get('lm:' + d.id);
    const isSel = S.sel && S.sel.kind === 'lm' && S.sel.id === d.id;
    const pairOptions = lms.filter(x => x.id !== d.id)
      .map(x => `<option value="${esc(x.id)}"${d.bilateral_pair === x.id ? ' selected' : ''}>${esc(x.id)} · ${esc(x.name)}</option>`).join('');
    return `
      <li class="tpl-item${isSel ? ' is-active' : ''}" data-row="${esc(d.id)}" data-kind="lm">
        <div class="tpl-line">
          <span class="ord">${i + 1}</span>
          <label class="visually-hidden" for="tpl-id-${k}">ID of ${esc(d.name)}</label>
          <input id="tpl-id-${k}" class="tpl-id mono" type="text" value="${esc(d.id)}" data-edit="id" spellcheck="false"
            ${hasData ? 'readonly title="Locked: this landmark already has data"' : ''}>
          <label class="visually-hidden" for="tpl-name-${k}">Name of ${esc(d.id)}</label>
          <input id="tpl-name-${k}" class="tpl-name" type="text" value="${esc(d.name)}" data-edit="name">
          ${this._btns('lm', d, i, lms.length)}
        </div>
        ${err ? `<p class="tpl-err" role="alert">${esc(err)}</p>` : ''}
        ${this._confirm('lm', d)}
        <details class="tpl-more"${this.open.has('lm:' + d.id) ? ' open' : ''}>
          <summary>${d.description ? esc(d.description) : 'Add placement instructions'}${d.bilateral_pair ? ` · pair ${esc(d.bilateral_pair)}` : ''}</summary>
          <label class="field-stack">Where to place it
            <textarea id="tpl-desc-${k}" rows="2" data-edit="description" placeholder="Shown to students while placing">${esc(d.description || '')}</textarea>
          </label>
          <label class="field-stack">Bilateral pair
            <select id="tpl-pair-${k}" data-edit="pair">
              <option value="">None</option>${pairOptions}
            </select>
          </label>
        </details>
      </li>`;
  }

  _curveRow(c, i, curves, lms) {
    const { S, C } = this.ctx;
    const hasData = C.specimensWith(S, 'curve', c.id) > 0;
    const k = key(c.id);
    const err = this.errors.get('curve:' + c.id);
    const isSel = S.sel && S.sel.kind === 'curve' && S.sel.id === c.id;
    const n = C.nPointsOf(c), path = c.path || 'polyline';
    const lmOptions = cur => lms.map(x => `<option value="${esc(x.id)}"${cur === x.id ? ' selected' : ''}>${esc(x.id)} · ${esc(x.name)}</option>`).join('');
    const route = c.closed ? 'closed loop' : `${c.start || 'free'} → ${c.end || 'free'}`;
    const summary = `${n} point${n === 1 ? '' : 's'} · ${route} · ${path === 'spline' ? 'smooth' : 'straight'}${c.description ? ' · ' + c.description : ''}`;
    return `
      <li class="tpl-item${isSel ? ' is-active' : ''}" data-row="${esc(c.id)}" data-kind="curve">
        <div class="tpl-line">
          <span class="ord">${i + 1}</span>
          <label class="visually-hidden" for="tpl-cid-${k}">ID of ${esc(c.name)}</label>
          <input id="tpl-cid-${k}" class="tpl-id mono" type="text" value="${esc(c.id)}" data-edit="id" spellcheck="false"
            ${hasData ? 'readonly title="Locked: this curve already has data"' : ''}>
          <label class="visually-hidden" for="tpl-cname-${k}">Name of ${esc(c.id)}</label>
          <input id="tpl-cname-${k}" class="tpl-name" type="text" value="${esc(c.name)}" data-edit="name">
          ${this._btns('curve', c, i, curves.length)}
        </div>
        ${err ? `<p class="tpl-err" role="alert">${esc(err)}</p>` : ''}
        ${this._confirm('curve', c)}
        <details class="tpl-more"${this.open.has('curve:' + c.id) ? ' open' : ''}>
          <summary>${esc(summary)}</summary>
          <div class="tpl-grid">
            <label class="field-stack">Starts on
              <select id="tpl-start-${k}" data-edit="start"${c.closed ? ' disabled' : ''}>
                <option value="">No landmark (free end)</option>${lmOptions(c.start)}
              </select>
            </label>
            <label class="field-stack">Ends on
              <select id="tpl-end-${k}" data-edit="end"${c.closed ? ' disabled' : ''}>
                <option value="">No landmark (free end)</option>${lmOptions(c.end)}
              </select>
            </label>
            <label class="field-stack">Semilandmarks
              <input id="tpl-n-${k}" type="number" min="1" max="${C.MAX_CURVE_POINTS}" step="1" value="${esc(n)}" data-edit="n_points">
            </label>
            <label class="field-stack">Line between clicks
              <select id="tpl-path-${k}" data-edit="path">
                <option value="polyline"${path === 'polyline' ? ' selected' : ''}>Straight</option>
                <option value="spline"${path === 'spline' ? ' selected' : ''}>Smooth</option>
              </select>
            </label>
          </div>
          <label class="check"><input id="tpl-closed-${k}" type="checkbox" data-edit="closed"${c.closed ? ' checked' : ''}> Closed loop, such as an orbit rim</label>
          <p class="hint">${c.closed ? 'Points go all the way round.' : 'Points between the two ends; landmarks the curve starts or ends on are not counted.'}</p>
          <label class="field-stack">How to trace it
            <textarea id="tpl-cdesc-${k}" rows="2" data-edit="description" placeholder="Shown to students while clicking along it">${esc(c.description || '')}</textarea>
          </label>
        </details>
      </li>`;
  }

  _onChange(e) {
    const { S, C, mutate } = this.ctx;
    const field = e.target.dataset.field;
    if (field) {
      const err = mutate(() => C.setTemplateField(S, field, e.target.value));
      this._setError('meta', err);
      return;
    }
    const edit = e.target.dataset.edit;
    const row = e.target.closest('[data-row]');
    if (!edit || !row) return;
    const id = row.dataset.row, kind = row.dataset.kind;
    if (kind === 'lm' && edit === 'pair') { mutate(() => C.setPair(S, id, e.target.value || null)); return; }
    let value = e.target.value;
    if (edit === 'closed') value = e.target.checked;
    else if (edit === 'start' || edit === 'end') value = value || null;
    const nid = String(value).trim();
    const err = mutate(() => {
      const r = kind === 'curve' ? C.updateCurve(S, id, { [edit]: value }) : C.updateDef(S, id, { [edit]: value });
      // a renamed item stays selected
      if (!r && edit === 'id' && S.sel && S.sel.kind === kind && S.sel.id === id) S.sel = { kind, id: nid };
      return r;
    });
    if (!err && edit === 'id') {
      if (this.open.delete(`${kind}:${id}`)) this.open.add(`${kind}:${nid}`);
      this.errors.delete(`${kind}:${id}`);
    }
    this._setError(`${kind}:${err ? id : (edit === 'id' ? String(value).trim() : id)}`, err);
  }

  _setError(k, err) {
    if (err) this.errors.set(k, err); else this.errors.delete(k);
    this.requestRender();
  }

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !this.el.contains(btn)) return;
    const { S, C, mutate, ctx } = { ...this.ctx, ctx: this.ctx };
    const row = btn.closest('[data-row]');
    const id = row && row.dataset.row, kind = row && row.dataset.kind;
    switch (btn.dataset.act) {
      case 'up': mutate(() => C.moveItem(S, kind, id, -1)); break;
      case 'down': mutate(() => C.moveItem(S, kind, id, 1)); break;
      case 'del': this.confirming = `${kind}:${id}`; this.requestRender(); break;
      case 'del-yes':
        this.confirming = null; this.errors.delete(`${kind}:${id}`);
        mutate(() => kind === 'curve' ? C.removeCurve(S, id) : C.removeDef(S, id));
        break;
      case 'new': this.confirming = '*new*'; this.requestRender(); break;
      case 'new-yes': this.confirming = null; this.errors.clear(); mutate(() => C.newTemplate(S)); break;
      case 'cancel': this.confirming = null; this.requestRender(); break;
      case 'add': this._addOne(); break;
      case 'add-curve': this._addCurve(); break;
      case 'add-bulk': {
        const box = this.el.querySelector('#tpl-bulk');
        const names = box.value.split(/\r?\n/);
        box.value = '';
        const ids = mutate(() => C.addDefs(S, names));
        if (ids && ids.length) ctx.afterAdd('lm', ids[0]);
        break;
      }
      case 'tpl-save': ctx.saveTemplate(); break;
      case 'tpl-load': ctx.loadTemplate(); break;
      case 'tpl-text': ctx.editAsText(); break;
    }
  }

  _addOne() {
    const { S, C, mutate } = this.ctx;
    const input = this.el.querySelector('#tpl-new-name');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    input.value = '';
    const ids = mutate(() => C.addDefs(S, [name]));
    if (ids && ids.length) this.ctx.afterAdd('lm', ids[0]);
    this.render();
    const again = this.el.querySelector('#tpl-new-name');
    if (again) again.focus();
  }

  _addCurve() {
    const { S, C, mutate } = this.ctx;
    const input = this.el.querySelector('#tpl-new-curve');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    input.value = '';
    const id = mutate(() => C.addCurve(S, name));
    if (id) { this.open.add('curve:' + id); this.ctx.afterAdd('curve', id); }
    this.render();
    const again = this.el.querySelector('#tpl-new-curve');
    if (again) again.focus();
  }
}

root.LmkTemplateEditor = TemplateEditor;
})(window);

// Small UI building blocks (no framework).
import { h } from '../core/util.js';

export const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#i-${name}`); s.appendChild(u); return s;
};

export function section(title, ...children) {
  return h('div.section', {}, title ? h('h3', {}, title) : null, ...children);
}

/** Length input in the user's unit (stores metres). */
export function lengthField(app, label, value, onChange, { min = 0, max = 100, nullable = false, placeholder = '' } = {}) {
  const cm = app.settings.units === 'cm';
  const inp = h('input', { type: 'number', inputmode: 'decimal', step: cm ? 1 : 0.01, min: cm ? min * 100 : min, max: cm ? max * 100 : max, placeholder });
  const set = (v) => { inp.value = v == null || v === '' ? '' : cm ? Math.round(v * 100) : (+v).toFixed(2); };
  set(value);
  inp.addEventListener('change', () => {
    if (inp.value === '' && nullable) { onChange(null); return; }
    let v = parseFloat(String(inp.value).replace(',', '.'));
    if (!isFinite(v)) { set(value); return; }
    v = cm ? v / 100 : v;
    v = Math.max(min, Math.min(max, v));
    onChange(Math.round(v * 1000) / 1000);
  });
  const el = h('label.field', {}, h('span', {}, label), h('span.unit-input', {}, inp, h('em', {}, cm ? 'cm' : 'm')));
  el.input = inp; el.set = set;
  return el;
}

export function numberField(label, value, onChange, { step = 1, min = -1e9, max = 1e9, unit = '' } = {}) {
  const inp = h('input', { type: 'number', inputmode: 'decimal', step, min, max, value });
  inp.addEventListener('change', () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (isFinite(v)) onChange(Math.max(min, Math.min(max, v))); });
  return h('label.field', {}, h('span', {}, label), h('span.unit-input', {}, inp, unit ? h('em', {}, unit) : null));
}

export function textField(label, value, onChange, { placeholder = '' } = {}) {
  const inp = h('input.input', { type: 'text', value: value ?? '', placeholder });
  inp.addEventListener('change', () => onChange(inp.value.trim()));
  return h('label.field.stack', {}, h('span', {}, label), inp);
}

export function selectField(label, value, options, onChange) {
  const sel = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label.field', {}, h('span', {}, label), sel);
}

export function switchField(label, checked, onChange) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked: !!checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label.switch', {}, h('span', {}, label), inp);
}

export function colorField(label, value, onChange, { allowReset = false, resetLabel = 'Auto' } = {}) {
  const inp = h('input', { type: 'color', value: value || '#cccccc' });
  inp.addEventListener('input', () => onChange(inp.value, true));
  inp.addEventListener('change', () => onChange(inp.value, false));
  const reset = allowReset ? h('button.btn.small.ghost', { type: 'button', onclick: () => onChange(null, false) }, resetLabel) : null;
  return h('label.field', {}, h('span', {}, label), h('span.row', {}, reset, inp));
}

export function rangeField(label, value, { min, max, step, fmt = (v) => v }, onInput) {
  const out = h('output', {}, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); onInput(+inp.value, true); });
  inp.addEventListener('change', () => onInput(+inp.value, false));
  return h('label.field.stack', {}, h('span.row', {}, h('span.grow', {}, label), out), inp);
}

/** Modal dialog. Returns {dlg, body, foot, close}. */
export function openDialog({ title, narrow = false, onClose, closeLabel = 'Close' }) {
  const body = h('div.dlg-body');
  const foot = h('div.dlg-foot');
  const head = h('div.dlg-head', {}, h('h2', {}, title), h('button.iconbtn', { type: 'button', 'aria-label': closeLabel, onclick: () => close() }, icon('close')));
  const dlg = h(`dialog.dlg${narrow ? '.narrow' : ''}`, {}, h('div.dlg-inner', {}, head, body, foot));
  document.body.appendChild(dlg);
  let closed = false;
  const close = (result) => {
    if (closed) return; closed = true;
    try { dlg.close(); } catch { /* */ }
    dlg.remove(); onClose?.(result);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.showModal();
  const inner = dlg.querySelector('.dlg-inner'); inner.tabIndex = -1; inner.style.outline = 'none'; inner.focus();
  return { dlg, body, foot, head, close, setTitle: (t) => { head.querySelector('h2').textContent = t; } };
}

export function confirmDialog(app, { title, text, ok, danger = false }) {
  return new Promise((resolve) => {
    const d = openDialog({ title, narrow: true, onClose: (r) => resolve(!!r), closeLabel: app.t('common.close') });
    d.body.append(h('p', {}, text));
    d.foot.append(
      h('button.btn.ghost', { onclick: () => d.close(false) }, app.t('common.cancel')),
      h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => d.close(true) }, ok || app.t('common.ok')),
    );
  });
}

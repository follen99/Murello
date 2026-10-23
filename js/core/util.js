// Small shared helpers. No dependencies.

let _uidCounter = 0;
export function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, d = 3) => { const k = 10 ** d; return Math.round(v * k) / k; };
export const deg2rad = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;
export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function debounce(fn, ms = 200) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Format a length in metres for display, honouring the unit preference. */
export function fmtLen(m, unit = 'm', lang = 'it') {
  if (m == null || !isFinite(m)) return '–';
  const dec = lang === 'it' ? ',' : '.';
  if (unit === 'cm') return `${Math.round(m * 100)} cm`;
  return `${m.toFixed(2).replace('.', dec)} m`;
}
export function fmtArea(m2, lang = 'it') {
  if (m2 == null || !isFinite(m2)) return '–';
  const dec = lang === 'it' ? ',' : '.';
  return `${m2.toFixed(1).replace('.', dec)} m²`;
}

/**
 * Parse a length written by a human. Accepts "3.40", "3,4", "340cm", "3.4 m",
 * "3m40", "2400mm". Integers without a unit: >= `cmThreshold` are centimetres.
 * Returns metres or null.
 */
export function parseLength(text, { defaultUnit = 'auto', cmThreshold = 20 } = {}) {
  if (text == null) return null;
  let s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let m = s.match(/^(\d+)\s*m\s*(\d{1,2})$/); // 3m40
  if (m) return +m[1] + +m[2] / (m[2].length === 1 ? 10 : 100);
  m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\.?$/);
  if (!m) return null;
  const hasDec = /[.,]/.test(m[1]);
  const v = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(v) || v <= 0) return null;
  const u = m[2];
  if (u === 'mm') return v / 1000;
  if (u === 'cm') return v / 100;
  if (u === 'm') return v;
  if (defaultUnit === 'cm') return v / 100;
  if (defaultUnit === 'm') return v;
  if (defaultUnit === 'mm') return v / 1000;
  if (hasDec) return v;
  if (v >= 1000) return v / 1000; // probably millimetres
  return v >= cmThreshold ? v / 100 : v;
}

/** Find all length-like tokens in a free text label. */
export const LENGTH_TOKEN = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?(?![a-z])/gi;

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}

export function slug(s) {
  return String(s || 'progetto').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'progetto';
}

/** Deterministic pseudo random generator (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse a CSS hex colour to [r,g,b] 0..1 */
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!isFinite(n) || h.length !== 6) return null;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return null;
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this._h.get(ev)?.delete(fn);
  }
  emit(ev, ...args) { this._h.get(ev)?.forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }
}

/** Tiny helper to create DOM elements: h('div.cls#id', {attrs}, children) */
export function h(tag, attrs = {}, ...children) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  (m?.[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

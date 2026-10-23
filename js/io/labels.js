// Parsing of human-written labels: "Cucina 4x3.5 h=2.70", "3,40", "340 cm", "sp=30", "1.41 45°".
import { parseLength } from '../core/util.js';

const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '\\s*(mm|cm|m)?';
const LEN = `${NUM}${UNIT}`;

function lenFrom(num, unit, opts) { return parseLength(`${num}${unit || ''}`, opts); }

/**
 * @returns {{name:string, measure:number|null, measures:number[], wxd:[number,number]|null,
 *   height:number|null, thickness:number|null, sill:number|null, angle:number|null, mode:string|null}}
 */
export function parseLabel(text, opts = {}) {
  let s = ` ${String(text || '').replace(/\n/g, ' ')} `;
  const out = { name: '', measure: null, measures: [], wxd: null, height: null, thickness: null, sill: null, angle: null, mode: null };
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(m); return ' '; }); };
  take(new RegExp(`[\\s,;(](?:h|alt(?:ezza)?|height)\\s*[=:]?\\s*${LEN}(?![\\d.,])`, 'gi'), (m) => { out.height = lenFrom(m[1], m[2], { ...opts, cmThreshold: 5 }); });
  take(new RegExp(`[\\s,;(](?:sp|spess(?:ore)?|th|thk|t)\\s*[=:]\\s*${LEN}`, 'gi'), (m) => { out.thickness = lenFrom(m[1], m[2], { ...opts, cmThreshold: 1.5 }); });
  take(new RegExp(`[\\s,;(](?:dav(?:anzale)?|sill)\\s*[=:]?\\s*${LEN}`, 'gi'), (m) => { out.sill = lenFrom(m[1], m[2], { ...opts, cmThreshold: 3 }); });
  take(/[\s,;(](asse|axis|netto|net|interno)[\s,;)]/gi, (m) => { out.mode = /asse|axis/i.test(m[1]) ? 'axis' : 'net'; });
  take(new RegExp(`${NUM}\\s*°`, 'g'), (m) => { out.angle = parseFloat(m[1].replace(',', '.')); });
  take(new RegExp(`${LEN}\\s*[x×*]\\s*${LEN}`, 'gi'), (m) => {
    const a = lenFrom(m[1], m[2] || m[4], opts), b = lenFrom(m[3], m[4] || m[2], opts);
    if (a && b) out.wxd = [a, b];
  });
  take(/(\d+)\s*m\s*(\d{1,2})(?![\d.,])/g, (m) => { out.measures.push(+m[1] + +m[2] / (m[2].length === 1 ? 10 : 100)); });
  take(new RegExp(`(?<=[\\s(=:])${LEN}(?=[\\s),;]|$)`, 'gi'), (m) => {
    const v = lenFrom(m[1], m[2], opts); if (v) out.measures.push(v);
  });
  out.measure = out.measures[0] ?? null;
  out.name = s.replace(/[\s,;:=()]+/g, ' ').trim();
  return out;
}

/** Parse a meta line "murello: misure=asse h=2.7 est=30 int=10 unita=cm" */
export function parseMeta(text) {
  const s = String(text || '').replace(/^\s*(murello|fp3d)\s*:/i, '');
  const o = {};
  for (const m of s.matchAll(/([a-zà-ú_]+)\s*=\s*([^\s;,]+)/gi)) {
    const k = m[1].toLowerCase(), val = m[2];
    if (/^(misure|measures|mode)$/.test(k)) o.mode = /asse|axis/i.test(val) ? 'axis' : 'net';
    else if (/^(h|altezza|height)$/.test(k)) o.height = parseLength(val, { cmThreshold: 5 });
    else if (/^(est|ext|esterni)$/.test(k)) o.extThickness = parseLength(val, { cmThreshold: 1.5 });
    else if (/^(int|interni)$/.test(k)) o.intThickness = parseLength(val, { cmThreshold: 1.5 });
    else if (/^(unita|unità|unit|units)$/.test(k)) o.unit = /cm/i.test(val) ? 'cm' : /mm/i.test(val) ? 'mm' : 'm';
    else if (/^(quota|elevation|livello)$/.test(k)) o.elevation = parseFloat(val.replace(',', '.'));
    else if (/^(scala|scale)$/.test(k)) o.scale = parseFloat(val.replace(',', '.')); // px per metre
  }
  return o;
}

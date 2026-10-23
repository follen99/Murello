// Top-view thumbnails of furniture models, drawn from their parts (works for user models too).
import { resolveParts, modelDefaults } from '../furniture/models.js';

const MAT = { wood: '#c79a6b', dark: '#3d3a37', white: '#f5f4f0', metal: '#b9bcc0', black: '#2a2b2e', glass: '#cfe3ee', ceramic: '#fbfbfa', mattress: '#f3efe7', leaf: '#6f9a69', pot: '#b86f4c', counter: '#d2cdc5', screen: '#1d1f22' };
const cache = new Map();

export function lighten(hex, k) {
  const n = parseInt(String(hex).slice(1), 16); if (!isFinite(n)) return hex;
  const f = (c) => Math.round(c + (255 - c) * k);
  return `#${((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}

export function drawModelThumb(cv, model, { color, dims, H = 2.7, dark = false } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || +cv.getAttribute('width') || 64, Hh = cv.clientHeight || +cv.getAttribute('height') || 52;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const d = dims || modelDefaults(model, H);
  let parts = [];
  try { parts = resolveParts(model, d, H); } catch { parts = []; }
  const s = Math.min((W - 8) / Math.max(d.w, 0.1), (Hh - 8) / Math.max(d.d, 0.1));
  g.translate(W / 2, Hh / 2); g.scale(s, s);
  const main = color || model.color || '#c7b8a3';
  parts.sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const p of parts) {
    if (p.y > 2.2) continue;
    g.fillStyle = p.m === 'main' ? main : p.m === 'soft' ? lighten(main, 0.2) : p.m === 'accent' ? lighten(main, 0.45) : MAT[p.m] || main;
    g.strokeStyle = dark ? 'rgba(0,0,0,0.6)' : 'rgba(40,40,40,0.35)'; g.lineWidth = 1 / s;
    g.beginPath();
    if ((p.s === 'cyl' && p.ax !== 'z') || p.s === 'sph') g.ellipse(p.x, p.z, p.w / 2, p.d / 2, 0, 0, Math.PI * 2);
    else if (p.s === 'cyl') g.rect(p.x - p.w / 2, p.z, p.w, p.h);
    else { g.save(); g.translate(p.x, p.z); if (p.rot) g.rotate(-p.rot * Math.PI / 180); g.rect(-p.w / 2, -p.d / 2, p.w, p.d); g.restore(); }
    g.fill(); g.stroke();
  }
}

export function thumbKey(model, color) { return `${model.id}|${color || ''}|${JSON.stringify(model.parts).length}`; }
export { cache };

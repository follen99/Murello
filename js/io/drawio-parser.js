// draw.io / diagrams.net file reader.
// Handles: .drawio / .xml (mxfile), plain mxGraphModel, compressed diagrams (base64 + raw deflate),
// multi-page files, <object>/<UserObject> custom data, groups/containers (relative coordinates),
// edge waypoints, edge labels (child cells), rotation and flips.

export class DrawioError extends Error {}

/** Parse "a=1;b=2;flag;" → {a:'1', b:'2', flag:true, _first:'flag'} */
export function parseStyle(style) {
  const out = {};
  if (!style) return out;
  const parts = String(style).split(';');
  for (const p of parts) {
    if (!p) continue;
    const i = p.indexOf('=');
    if (i < 0) { out[p] = true; if (!out._first) out._first = p; } else out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

export function stripHtml(s) {
  if (!s) return '';
  let t = String(s);
  // Some XML parsers hand back attribute values still entity-encoded: decode once before stripping tags.
  if (!t.includes('<') && /&lt;|&gt;/.test(t)) t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  t = t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  return t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new DrawioError('compressed');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

async function decodeDiagram(text) {
  const raw = atob(text.trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const inflated = await inflateRaw(bytes);
  try { return decodeURIComponent(inflated); } catch { return inflated; }
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new DrawioError('xml');
  return doc;
}

const children = (el) => Array.from(el.childNodes || []).filter((n) => n.nodeType === 1);

function readGeometry(geoEl) {
  if (!geoEl) return null;
  const num = (k, d = 0) => { const v = geoEl.getAttribute(k); return v == null || v === '' ? d : parseFloat(v); };
  const g = { x: num('x'), y: num('y'), w: num('width'), h: num('height'), relative: geoEl.getAttribute('relative') === '1', points: [], sourcePoint: null, targetPoint: null, offset: null };
  for (const c of children(geoEl)) {
    const as = c.getAttribute('as');
    if (c.tagName === 'mxPoint') {
      const p = { x: parseFloat(c.getAttribute('x') || 0), y: parseFloat(c.getAttribute('y') || 0) };
      if (as === 'sourcePoint') g.sourcePoint = p; else if (as === 'targetPoint') g.targetPoint = p; else if (as === 'offset') g.offset = p;
    } else if (c.tagName === 'Array' && as === 'points') {
      for (const pt of children(c)) g.points.push({ x: parseFloat(pt.getAttribute('x') || 0), y: parseFloat(pt.getAttribute('y') || 0) });
    }
  }
  return g;
}

function readCells(modelEl) {
  const root = children(modelEl).find((c) => c.tagName === 'root');
  if (!root) return [];
  const cells = [];
  for (const el of children(root)) {
    let cellEl = el, attrs = {}, value = null;
    if (el.tagName === 'object' || el.tagName === 'UserObject') {
      for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
      value = attrs.label ?? '';
      cellEl = children(el).find((c) => c.tagName === 'mxCell');
      if (!cellEl) continue;
    } else if (el.tagName !== 'mxCell') continue;
    const id = el.getAttribute('id') ?? cellEl.getAttribute('id');
    const styleRaw = cellEl.getAttribute('style') || '';
    const style = parseStyle(styleRaw);
    const rawValue = value ?? cellEl.getAttribute('value') ?? '';
    cells.push({
      id,
      parent: cellEl.getAttribute('parent'),
      vertex: cellEl.getAttribute('vertex') === '1',
      edge: cellEl.getAttribute('edge') === '1',
      source: cellEl.getAttribute('source'),
      target: cellEl.getAttribute('target'),
      rawValue,
      text: stripHtml(rawValue),
      style, styleRaw, attrs,
      geo: readGeometry(children(cellEl).find((c) => c.tagName === 'mxGeometry')),
      rotation: parseFloat(style.rotation || 0) || 0,
    });
  }
  return cells;
}

/** Resolve absolute geometry and edge polylines. */
function resolve(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const absCache = new Map();
  const originOf = (id) => {
    if (absCache.has(id)) return absCache.get(id);
    const c = byId.get(id);
    let o = { x: 0, y: 0 };
    if (c && c.vertex && c.geo && !c.geo.relative) {
      const po = originOf(c.parent);
      o = { x: po.x + c.geo.x, y: po.y + c.geo.y };
    }
    absCache.set(id, o);
    return o;
  };
  for (const c of cells) {
    if (c.vertex && c.geo && !c.geo.relative) {
      const po = originOf(c.parent);
      c.box = { x: po.x + c.geo.x, y: po.y + c.geo.y, w: c.geo.w, h: c.geo.h };
      c.center = { x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h / 2 };
    }
  }
  // Edge polylines
  for (const c of cells) {
    if (!c.edge || !c.geo) continue;
    const po = originOf(c.parent);
    const tr = (p) => ({ x: p.x + po.x, y: p.y + po.y });
    const pts = c.geo.points.map(tr);
    let s = c.geo.sourcePoint ? tr(c.geo.sourcePoint) : null;
    let t = c.geo.targetPoint ? tr(c.geo.targetPoint) : null;
    const term = (cid, ex, ey, toward) => {
      const v = byId.get(cid); if (!v?.box) return null;
      if (ex != null && ey != null && ex !== '' && ey !== '') return { x: v.box.x + parseFloat(ex) * v.box.w, y: v.box.y + parseFloat(ey) * v.box.h };
      if (!toward) return { ...v.center };
      return perimeterPoint(v.box, toward);
    };
    if (c.source && byId.get(c.source)?.box) {
      const toward = pts[0] || (t) || byId.get(c.target)?.center;
      s = term(c.source, c.style.exitX, c.style.exitY, toward) || s;
    }
    if (c.target && byId.get(c.target)?.box) {
      const toward = pts[pts.length - 1] || s || byId.get(c.source)?.center;
      t = term(c.target, c.style.entryX, c.style.entryY, toward) || t;
    }
    if (!s || !t) continue;
    c.polyline = [s, ...pts, t];
  }
  // Edge labels (child vertices of edges with relative geometry)
  for (const c of cells) {
    const p = byId.get(c.parent);
    if (p && p.edge && c.vertex && c.geo?.relative) {
      (p.extraLabels ||= []).push({ text: c.text, pos: c.geo.x, cell: c });
      c.isEdgeLabel = true;
    }
  }
  // Pages layers: cells whose parent is the root ("0") are layers
  for (const c of cells) {
    if (!c.parent || c.parent === '0' || (!c.vertex && !c.edge)) c.isStructural = true;
    const p = byId.get(c.parent);
    if (p && p.vertex && !p.isStructural) c.groupParent = p.id;
    if (p && p.vertex) p.hasChildren = true;
  }
  return cells;
}

function perimeterPoint(box, toward) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Point at relative position `rel` (-1..1) along a polyline (draw.io edge label convention). */
export function pointAlongPolyline(pl, rel) {
  const segs = []; let total = 0;
  for (let i = 0; i < pl.length - 1; i++) { const l = Math.hypot(pl[i + 1].x - pl[i].x, pl[i + 1].y - pl[i].y); segs.push(l); total += l; }
  let d = ((rel + 1) / 2) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? Math.max(0, Math.min(1, d / segs[i])) : 0;
      return { x: pl[i].x + (pl[i + 1].x - pl[i].x) * t, y: pl[i].y + (pl[i + 1].y - pl[i].y) * t, seg: i };
    }
    d -= segs[i];
  }
  return { ...pl[0], seg: 0 };
}

/**
 * Parse a draw.io file text. Returns { pages: [{id, name, cells}] }.
 */
export async function parseDrawio(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('<')) throw new DrawioError('notxml');
  const doc = parseXml(trimmed);
  const top = doc.documentElement;
  const pages = [];
  if (top.tagName === 'mxGraphModel') {
    pages.push({ id: 'page-1', name: 'Page-1', cells: resolve(readCells(top)) });
  } else if (top.tagName === 'mxfile') {
    const diagrams = children(top).filter((c) => c.tagName === 'diagram');
    let i = 0;
    for (const d of diagrams) {
      i++;
      let model = children(d).find((c) => c.tagName === 'mxGraphModel');
      if (!model) {
        const txt = d.textContent || '';
        if (!txt.trim()) continue;
        const xml = await decodeDiagram(txt);
        model = parseXml(xml).documentElement;
      }
      pages.push({ id: d.getAttribute('id') || `page-${i}`, name: d.getAttribute('name') || `Page-${i}`, cells: resolve(readCells(model)) });
    }
  } else if (top.tagName === 'svg') {
    const content = top.getAttribute('content');
    if (content) return parseDrawio(content);
    throw new DrawioError('svg');
  } else {
    throw new DrawioError('unknown');
  }
  if (!pages.length) throw new DrawioError('empty');
  return { pages };
}

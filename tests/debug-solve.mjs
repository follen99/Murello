import './setup-dom.mjs';
import { readFileSync } from 'node:fs';
import { parseDrawio } from '../js/io/drawio-parser.js';
import { extractPage } from '../js/io/plan-extract.js';
import { solvePlan } from '../js/io/solver.js';
const file = process.argv[2];
const opts = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const doc = await parseDrawio(readFileSync(file, 'utf8'));
for (const page of doc.pages) {
  const raw = extractPage(page, {});
  console.log('PAGE', page.name, raw.counts, 'meta', raw.meta);
  console.log('segments', raw.segments.length, 'rooms', raw.rooms.length, 'openings', raw.openings.length, 'items', raw.items.length, 'unknowns', raw.unknowns.map(u=>u.sig+':'+u.text));
  const res = solvePlan(raw, { mode: raw.meta.mode || 'net', ...opts });
  console.log('scale', res.scale.toFixed(5), 'complete', res.complete);
  console.log('missing', res.issues.missing.map(m => `${m.kind} ${m.key} est=${m.estimate.toFixed(2)} piece=${m.piece}`));
  console.log('conflicts', res.issues.conflicts.map(c => `${c.axis} diff=${c.diff.toFixed(3)} cycle=[${c.cycle.map(x=>x.src.type+':'+x.src.text).join(', ')}]`));
  console.log('notes', JSON.stringify(res.issues.notes), 'assumptions', res.issues.assumptions);
  const nm = new Map(res.nodes.map(n=>[n.id,n]));
  for (const w of res.walls) { const a=nm.get(w.a), b=nm.get(w.b); console.log(` wall ${w.id} (${a.x.toFixed(2)},${a.y.toFixed(2)})-(${b.x.toFixed(2)},${b.y.toFixed(2)}) L=${Math.hypot(a.x-b.x,a.y-b.y).toFixed(3)} t=${w.thickness} ext=${w.exterior} open=${w.openings.map(o=>o.type+'@'+o.offset.toFixed(2)+'w'+o.width.toFixed(2)).join(',')}`); }
  console.log('rooms', res.rooms.map(r => `${r.name}(${r.anchor.x.toFixed(2)},${r.anchor.y.toFixed(2)}) h=${r.height}`));
  console.log('items', res.items.map(i => `${i.model} ${i.name} @${i.x.toFixed(2)},${i.y.toFixed(2)} ${i.w.toFixed(2)}x${i.d.toFixed(2)} r${i.rot}`));
}

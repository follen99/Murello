// Import a sample, export it to draw.io, re-import it and compare the geometry.
import './setup-dom.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseDrawio } from '../js/io/drawio-parser.js';
import { extractPage } from '../js/io/plan-extract.js';
import { solvePlan } from '../js/io/solver.js';
import { projectFromPages } from '../js/io/build-project.js';
import { exportDrawio } from '../js/io/drawio-export.js';
import { serializeProject, parseProject } from '../js/io/project-io.js';

async function importText(text, opts = {}) {
  const doc = await parseDrawio(text);
  const solved = doc.pages.map((page) => { const raw = extractPage(page, {}); return { page, raw, res: solvePlan(raw, { mode: raw.meta.mode || 'net', ...opts }) }; });
  return { solved, project: projectFromPages(solved, { name: 'test', settings: {} }) };
}
const sumLen = (f) => { const m = new Map(f.nodes.map((n) => [n.id, n])); return f.walls.reduce((s, w) => s + Math.hypot(m.get(w.a).x - m.get(w.b).x, m.get(w.a).y - m.get(w.b).y), 0); };

let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails++; console.log('✗', name, '\n ', e.message); } };

await test('apartment sample solves completely', async () => {
  const { solved, project } = await importText(readFileSync('examples/appartamento.drawio', 'utf8'));
  assert.equal(solved[0].res.complete, true);
  assert.equal(solved[0].res.issues.conflicts.length, 0);
  assert.equal(project.floors[0].walls.length, 19);
  assert.equal(project.floors[0].items.length, 3);
  const f = project.floors[0];
  assert.ok(Math.abs(sumLen(f) - 68.5) < 0.05, `total wall length ${sumLen(f)}`);
});

await test('line sample reports the missing measure and the oblique conflict', async () => {
  const { solved } = await importText(readFileSync('examples/bilocale-misure-mancanti.drawio', 'utf8'));
  const r = solved[0].res;
  assert.equal(r.complete, false);
  assert.equal(r.issues.missing.length, 1);
  assert.equal(r.issues.missing[0].kind, 'x');
  assert.equal(r.issues.conflicts.length, 1);
  assert.ok(r.issues.conflicts[0].cycle.length >= 5);
});

await test('user answer completes the plan', async () => {
  const { solved } = await importText(readFileSync('examples/bilocale-misure-mancanti.drawio', 'utf8'), { userMeasures: { 'pair:0,0|450,0|x': 4.5 } });
  assert.equal(solved[0].res.complete, true);
});

await test('draw.io export → import round trip keeps geometry, openings and furniture', async () => {
  const { project } = await importText(readFileSync('examples/appartamento.drawio', 'utf8'));
  const f0 = project.floors[0];
  f0.walls[0].decor = [{ id: 'd1', type: 'picture', side: 1, offset: 1, width: 0.7, height: 0.5, elevation: 1.4 }];
  const xml = exportDrawio(project);
  const { solved, project: p2 } = await importText(xml);
  assert.equal(solved[0].res.complete, true, 'complete after round trip');
  const f1 = p2.floors[0];
  assert.equal(f1.walls.length, f0.walls.length);
  assert.ok(Math.abs(sumLen(f1) - sumLen(f0)) < 0.02, `${sumLen(f1)} vs ${sumLen(f0)}`);
  const op = (f) => f.walls.reduce((s, w) => s + w.openings.length, 0);
  assert.equal(op(f1), op(f0));
  assert.equal(f1.items.length, f0.items.length);
  assert.equal(f1.walls.reduce((s, w) => s + w.decor.length, 0), 1);
  assert.equal(f1.height, f0.height);
});

await test('native format round trip', async () => {
  const { project } = await importText(readFileSync('examples/appartamento.drawio', 'utf8'));
  const p2 = parseProject(serializeProject(project));
  assert.deepEqual(p2.floors[0].walls, project.floors[0].walls);
  assert.deepEqual(p2.floors[0].items, project.floors[0].items);
});

process.exit(fails ? 1 : 0);

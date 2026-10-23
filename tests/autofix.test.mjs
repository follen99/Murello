// Measurement check: removed walls, suspicious units, automatic proposals and the AI-rules example.
import './setup-dom.mjs';
import assert from 'node:assert/strict';
import { parseDrawio } from '../js/io/drawio-parser.js';
import { extractPage } from '../js/io/plan-extract.js';
import { solvePlan, pieceKey } from '../js/io/solver.js';
import { proposeMissing, applyMissing, proposeConflictFix, applyFix } from '../js/io/auto-fix.js';
import { AI_RULES } from '../js/ui/ai-rules.js';

const line = (id, x1, y1, x2, y2, v = '') => `<mxCell id="${id}" value="${v}" style="endArrow=none;html=1;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`;
const text = (id, v, x, y) => `<mxCell id="${id}" value="${v}" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="80" height="20" as="geometry"/></mxCell>`;
const file = (cells) => `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
const load = async (cells) => extractPage((await parseDrawio(file(cells))).pages[0], {});
const OPTS = { mode: 'axis', userMeasures: {}, overrides: {}, angles: {}, excluded: [] };

let fails = 0;
const test = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails++; console.log('✗', name, '\n ', e.message); } };

// 400 × 300 room, plus a stray helper line hanging off the bottom-left corner
const room = [line('a', 0, 0, 400, 0, '400'), line('b', 400, 0, 400, 300, '300'), line('c', 400, 300, 0, 300, '400'), line('d', 0, 300, 0, 0, '300')];

await test('removed walls disappear and can be restored', async () => {
  const raw = await load([...room, line('x', 0, 300, -60, 300)]);
  const before = solvePlan(raw, OPTS);
  assert.equal(before.issues.missing.length, 1);
  const key = pieceKey({ x: 0, y: 300 }, { x: -60, y: 300 });
  const after = solvePlan(raw, { ...OPTS, excluded: [key] });
  assert.equal(after.issues.missing.length, 0);
  assert.equal(after.walls.length, 4);
  assert.deepEqual(after.preview.excluded.map((e) => e.key), [key]);
});

await test('a centimetre value read as metres is flagged with a proposal', async () => {
  const raw = await load([...room, line('s', 400, 0, 400, -19, '19')]);
  const res = solvePlan(raw, OPTS);
  assert.equal(res.issues.suspicious.length, 1);
  assert.equal(res.issues.suspicious[0].proposed, 0.19);
  const fixed = solvePlan(raw, { ...OPTS, overrides: { [res.issues.suspicious[0].key]: 0.19 } });
  assert.equal(fixed.issues.suspicious.length, 0);
});

await test('a slanted wall asks for its angle once its length is given', async () => {
  // open chain: the slanted wall is the only link between the two straight ones
  const raw = await load([line('a', 0, 0, 300, 0, '300'), line('b', 300, 0, 400, 100), line('c', 400, 100, 400, 300, '200')]);
  const pp = { ...OPTS, userMeasures: {}, angles: {} };
  const m = solvePlan(raw, pp).issues.missing.find((q) => q.kind === 'len');
  assert.ok(m, 'slanted wall not asked');
  pp.userMeasures[m.key] = 1.41;
  const next = solvePlan(raw, pp).issues.missing;
  assert.ok(!next.some((q) => q.key === m.key && q.kind === 'len'), 'same length asked again');
  assert.ok(next.some((q) => q.kind === 'angle'), 'angle not asked');
});

await test('approving the proposals resolves conflicts and missing lengths', async () => {
  // the bottom wall says 380 instead of 400, and the right wall has no length
  const raw = await load([line('a', 0, 0, 400, 0, '400'), line('b', 400, 0, 400, 300), line('c', 400, 300, 0, 300, '380'), line('d', 0, 300, 0, 0, '300')]);
  const pp = { ...OPTS, userMeasures: {}, overrides: {}, angles: {} };
  for (let i = 0; i < 10; i++) {
    const res = solvePlan(raw, pp);
    if (res.issues.conflicts.length) { const fix = proposeConflictFix(raw, pp, res, res.issues.conflicts[0]); assert.ok(fix, 'no fix proposed'); applyFix(pp, fix); continue; }
    if (res.issues.missing.length) { applyMissing(pp, proposeMissing(res.issues.missing[0])); continue; }
    break;
  }
  const res = solvePlan(raw, pp);
  assert.equal(res.issues.conflicts.length, 0);
  assert.equal(res.issues.missing.length, 0);
});

await test('the example in the AI rules imports cleanly', async () => {
  for (const lang of ['it', 'en']) {
    const s = AI_RULES[lang];
    const doc = await parseDrawio(s.slice(s.lastIndexOf('<mxfile')));
    const raw = extractPage(doc.pages[0], {});
    const res = solvePlan(raw, { mode: raw.meta.mode });
    assert.equal(res.complete, true);
    assert.equal(res.issues.conflicts.length, 0);
    assert.equal(res.walls.length, 4);
    assert.equal(res.walls.reduce((n, w) => n + w.openings.length, 0), 2);
    assert.equal(res.rooms[0].name, 'Soggiorno');
  }
});

await test('plain texts are never read as doors', async () => {
  const raw = await load([...room, text('t1', 'Ingresso', 150, 140), text('t2', 'porta d\'ingresso', 150, 320)]);
  assert.equal(raw.openings.length, 0);
});

if (fails) process.exit(1);

// World generation sanity checks: determinism, land share, biome mix, content counts.
import assert from 'node:assert/strict';
import { generateWorld, BIOME } from '../shared/worldgen.js';
import { makeMoveState, stepMove } from '../shared/movement.js';

const verbose = process.argv.includes('-v');
const t0 = performance.now();
const w = generateWorld('island', 12345);
const genMs = performance.now() - t0;
const w2 = generateWorld('island', 12345);
assert.equal(w.checksum(), w2.checksum(), 'same seed must give the same world');
assert.notEqual(w.checksum(), generateWorld('island', 999).checksum(), 'different seeds differ');

let land = 0;
const biomes = [0, 0, 0, 0, 0, 0];
let maxH = -99;
const N = 200;
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = -w.half + ((i + 0.5) / N) * w.size;
    const z = -w.half + ((j + 0.5) / N) * w.size;
    const h = w.heightAt(x, z);
    if (h > maxH) maxH = h;
    if (h > 0) {
      land++;
      biomes[w.biomeAt(x, z)]++;
    }
  }
}
const landFrac = land / (N * N);
const monsters = w.camps.reduce((a, c) => a + c.monsters.length, 0);
if (verbose) {
  console.log(`gen ${genMs.toFixed(0)}ms land ${(landFrac * 100).toFixed(1)}% maxH ${maxH.toFixed(1)}`);
  console.log('biomes', Object.keys(BIOME).map((k, i) => `${k} ${((biomes[i] / land) * 100).toFixed(0)}%`).join('  '));
  console.log(`props ${w.props.length} colliders ${w.colliders.length} camps ${w.camps.length} monsters ${monsters} chests ${w.chests.length} pois ${w.pois.length} spawns ${w.spawns.length}`);
  const types = {};
  for (const p of w.props) types[p.type] = (types[p.type] || 0) + 1;
  console.log(types);
}
assert.ok(landFrac > 0.3 && landFrac < 0.65, `land fraction ${landFrac}`);
assert.ok(w.camps.length >= 45, `camps ${w.camps.length}`);
assert.ok(w.chests.length >= 100, `chests ${w.chests.length}`);
assert.ok(w.spawns.length >= 50, `spawns ${w.spawns.length}`);
assert.ok(w.pois.length >= 14, `pois ${w.pois.length}`);
for (const c of w.camps) assert.ok(w.heightAt(c.x, c.z) > 2, 'camp on land');
for (const sp of w.spawns) assert.ok(w.heightAt(sp.x, sp.z) > 2, 'spawn on land');

// Movement: walk a bot across the island and make sure it stays on the ground and finite.
const sp = w.spawns[0];
const s = makeMoveState(sp.x, w.heightAt(sp.x, sp.z) + 1, sp.z);
const inp = { mx: 0.6, mz: 0.8, speed: 8, canMove: true, jump: false, extraJumps: 0 };
for (let i = 0; i < 2000; i++) {
  inp.jump = i % 40 === 0;
  stepMove(s, inp, 0.05, w);
  assert.ok(Number.isFinite(s.x + s.y + s.z), 'position stays finite');
  assert.ok(s.y >= w.heightAt(s.x, s.z) - 0.01 || s.swim, 'never below terrain');
}

// Raycasts
const d = w.raycast(sp.x, w.heightAt(sp.x, sp.z) + 30, sp.z, 0, -1, 0, 100);
assert.ok(Math.abs(d - 30) < 0.5, `ray straight down hits ground at ${d}`);
assert.equal(w.raycast(sp.x, 400, sp.z, 0, 1, 0, 50), -1);

const a = generateWorld('arena', 7);
assert.equal(a.spawns.length, 2);
assert.equal(a.camps.length, 0);
assert.equal(a.chests.length, 0);
console.log('world.test ok');

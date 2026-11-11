// Deterministic world generation shared by the server and the client.
// Given the same (mapId, seed) both sides build the exact same terrain, props, colliders, camps,
// chests and spawn points, so the server only ever has to send the seed.
import { MAPS, WATER_LEVEL, SWIM_DEPTH, smoothstep } from './constants.js';
import { RNG, hash2 } from './rng.js';
import { fbm } from './noise.js';

export const BIOME = { BEACH: 0, PLAINS: 1, FOREST: 2, DESERT: 3, HIGHLAND: 4, SNOW: 5 };
export const STEP_UP = 0.55;

// Prop catalogue. `r` = circle collider radius, `box` = [width, depth] box collider, `h` = collider
// height, `stand` = players can stand on top, `thin` = ignored by AI line-of-sight checks.
export const PROP_DEFS = {
  pine: { model: 'tree_pine', r: 0.42, h: 8, thin: true },
  oak: { model: 'tree_oak', r: 0.5, h: 7, thin: true },
  palm: { model: 'tree_palm', r: 0.34, h: 7, thin: true },
  dead: { model: 'tree_dead', r: 0.34, h: 5, thin: true },
  cactus: { model: 'cactus', r: 0.45, h: 3, thin: true },
  rock: { model: 'rock_a', r: 1.05, h: 1.35, stand: true },
  boulder: { model: 'rock_b', r: 1.7, h: 2.7, stand: true },
  bush: { model: 'bush' },
  grass: { model: 'grass' },
  flower: { model: 'flower' },
  wall: { model: 'ruin_wall', box: [4, 0.9], h: 3.2, stand: true },
  pillar: { model: 'ruin_pillar', r: 0.65, h: 4.6, stand: true },
  hut: { model: 'hut', box: [5.2, 5.2], h: 3.0, stand: true },
  tower: { model: 'watchtower', box: [3.4, 3.4], h: 9 },
  crate: { model: 'crate', box: [1.3, 1.3], h: 1.3, stand: true },
  barrel: { model: 'barrel', r: 0.55, h: 1.25, stand: true },
  tent: { model: 'tent', r: 1.7, h: 2.3 },
  campfire: { model: 'campfire' },
  banner: { model: 'banner', r: 0.18, h: 4, thin: true },
  spikes: { model: 'spikes', box: [3.2, 0.9], h: 1.3 },
  stone: { model: 'standing_stone', r: 0.85, h: 4.6 },
  altar: { model: 'altar', box: [2.6, 1.6], h: 1.0, stand: true },
  well: { model: 'well', r: 1.35, h: 1.1, stand: true },
};

const POI_NAMES = {
  ruins: ['Ashen Ruins', 'Sunken Halls', 'Old Bastion', 'Whisper Vault', 'Broken Court', 'Hollow Keep'],
  village: ['Mirefield', 'Dunmere', 'Thistlewick', 'Harrowgate', 'Saltmarsh', 'Brackenford'],
  outpost: ['Watch Hill', 'Ironpost', 'Greyfang Outpost', 'Lookout Point', 'Cinder Watch', 'Raven Perch'],
  shrine: ['Shrine of Embers', 'Shrine of Tides', 'Shrine of Storms', 'Shrine of Bone', 'Shrine of Stars', 'Shrine of Thorns', 'Shrine of Echoes', 'Shrine of Dusk'],
};

export class World {
  constructor(mapId, seed) {
    const cfg = MAPS[mapId];
    this.mapId = mapId;
    this.seed = seed >>> 0;
    this.size = cfg.size;
    this.half = cfg.size / 2;
    this.cell = cfg.cell;
    this.n = cfg.size / cfg.cell + 1;
    this.stormRadius = cfg.stormRadius;
    this.heights = new Float32Array(this.n * this.n);
    this.props = [];
    this.colliders = [];
    this.camps = [];
    this.chests = [];
    this.pois = [];
    this.spawns = [];
    this.clear = [];
    this.gcell = 8;
    this.gn = Math.ceil(cfg.size / this.gcell);
    this.grid = new Array(this.gn * this.gn).fill(null);
    this._stamp = 0;
    this._stamps = null;
  }

  // ---- terrain queries ---------------------------------------------------------------------

  heightAt(x, z) {
    const n = this.n;
    let fx = (x + this.half) / this.cell;
    let fz = (z + this.half) / this.cell;
    if (fx < 0) fx = 0;
    else if (fx > n - 1.0001) fx = n - 1.0001;
    if (fz < 0) fz = 0;
    else if (fz > n - 1.0001) fz = n - 1.0001;
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const H = this.heights;
    const k = j * n + i;
    // Same triangulation as the rendered mesh (diagonal from (i+1, j) to (i, j+1)).
    if (u + v <= 1) {
      const h00 = H[k];
      return h00 + (H[k + 1] - h00) * u + (H[k + n] - h00) * v;
    }
    const h11 = H[k + n + 1];
    return h11 + (H[k + n] - h11) * (1 - u) + (H[k + 1] - h11) * (1 - v);
  }

  // Surface a character with feet at height `y` would stand on at (x, z).
  groundAt(x, z, y) {
    let g = this.heightAt(x, z);
    const swim = WATER_LEVEL - SWIM_DEPTH;
    if (g < swim) g = swim;
    const cell = this._cell(x, z);
    if (cell) {
      const C = this.colliders;
      for (let i = 0; i < cell.length; i++) {
        const c = C[cell[i]];
        if (!c.stand || c.top <= g || c.top > y + STEP_UP) continue;
        const dx = x - c.x;
        const dz = z - c.z;
        if (c.circle) {
          if (dx * dx + dz * dz <= c.r * c.r) g = c.top;
        } else if (dx >= -c.hx && dx <= c.hx && dz >= -c.hz && dz <= c.hz) g = c.top;
      }
    }
    return g;
  }

  isSwimming(x, z) {
    return this.heightAt(x, z) < WATER_LEVEL - SWIM_DEPTH;
  }

  _cell(x, z) {
    const gx = ((x + this.half) / this.gcell) | 0;
    const gz = ((z + this.half) / this.gcell) | 0;
    if (gx < 0 || gz < 0 || gx >= this.gn || gz >= this.gn) return null;
    return this.grid[gz * this.gn + gx];
  }

  // Pushes a vertical cylinder (radius R, feet y, height h) out of static colliders.
  // `out` = {x, z} is modified in place. Returns true if anything was touched.
  collideCircle(out, R, y, h) {
    const g = this.gcell;
    const gx0 = Math.max(0, ((out.x - R + this.half) / g) | 0);
    const gx1 = Math.min(this.gn - 1, ((out.x + R + this.half) / g) | 0);
    const gz0 = Math.max(0, ((out.z - R + this.half) / g) | 0);
    const gz1 = Math.min(this.gn - 1, ((out.z + R + this.half) / g) | 0);
    const C = this.colliders;
    let hit = false;
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cell = this.grid[gz * this.gn + gx];
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const c = C[cell[i]];
          if (y >= c.top - STEP_UP || y + h <= c.base) continue;
          const dx = out.x - c.x;
          const dz = out.z - c.z;
          if (c.circle) {
            const rr = c.r + R;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2);
            if (d < 1e-5) {
              out.x = c.x + rr;
            } else {
              out.x = c.x + (dx / d) * rr;
              out.z = c.z + (dz / d) * rr;
            }
            hit = true;
          } else {
            const qx = dx < -c.hx ? -c.hx : dx > c.hx ? c.hx : dx;
            const qz = dz < -c.hz ? -c.hz : dz > c.hz ? c.hz : dz;
            const ex = dx - qx;
            const ez = dz - qz;
            const d2 = ex * ex + ez * ez;
            if (d2 >= R * R) continue;
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              out.x = c.x + qx + (ex / d) * R;
              out.z = c.z + qz + (ez / d) * R;
            } else {
              // centre is inside the box: leave through the nearest face
              const px = c.hx - Math.abs(dx);
              const pz = c.hz - Math.abs(dz);
              if (px < pz) out.x = c.x + (dx < 0 ? -1 : 1) * (c.hx + R);
              else out.z = c.z + (dz < 0 ? -1 : 1) * (c.hz + R);
            }
            hit = true;
          }
        }
      }
    }
    return hit;
  }

  // Ray against terrain and static colliders. (dx, dy, dz) must be normalised.
  // Returns the hit distance, or -1 when nothing is hit within maxDist.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignoreThin = false) {
    // --- terrain: march then bisect
    let limit = maxDist;
    const step = 1.5;
    let prev = 0;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = t > maxDist ? maxDist : t;
      const x = ox + dx * tt;
      const z = oz + dz * tt;
      if (x < -this.half || x > this.half || z < -this.half || z > this.half) break;
      if (oy + dy * tt < this.heightAt(x, z)) {
        let a = prev;
        let b = tt;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m < this.heightAt(ox + dx * m, oz + dz * m)) b = m;
          else a = m;
        }
        limit = b;
        break;
      }
      prev = tt;
      if (tt >= maxDist) break;
    }
    let best = limit < maxDist ? limit : -1;

    // --- colliders: 2D grid traversal
    const g = this.gcell;
    let cx = Math.floor((ox + this.half) / g);
    let cz = Math.floor((oz + this.half) / g);
    const sx = dx > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    let tMaxX = adx > 1e-9 ? ((cx + (dx > 0 ? 1 : 0)) * g - this.half - ox) / dx : Infinity;
    let tMaxZ = adz > 1e-9 ? ((cz + (dz > 0 ? 1 : 0)) * g - this.half - oz) / dz : Infinity;
    const tDX = adx > 1e-9 ? g / adx : Infinity;
    const tDZ = adz > 1e-9 ? g / adz : Infinity;
    if (!this._stamps || this._stamps.length < this.colliders.length) this._stamps = new Uint32Array(this.colliders.length + 16);
    const stamp = ++this._stamp;
    const stamps = this._stamps;
    const C = this.colliders;
    let t = 0;
    let guard = 0;
    while (t <= limit && guard++ < 400) {
      if (cx >= 0 && cz >= 0 && cx < this.gn && cz < this.gn) {
        const cell = this.grid[cz * this.gn + cx];
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            const idx = cell[i];
            if (stamps[idx] === stamp) continue;
            stamps[idx] = stamp;
            const c = C[idx];
            if (ignoreThin && c.thin) continue;
            const th = rayCollider(c, ox, oy, oz, dx, dy, dz);
            if (th >= 0 && th <= limit && (best < 0 || th < best)) best = th;
          }
        }
      } else if ((cx < 0 && sx < 0) || (cx >= this.gn && sx > 0) || (cz < 0 && sz < 0) || (cz >= this.gn && sz > 0)) break;
      const tNext = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (best >= 0 && best <= tNext) break;
      if (tNext === Infinity) break;
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDX;
        cx += sx;
      } else {
        t = tMaxZ;
        tMaxZ += tDZ;
        cz += sz;
      }
    }
    return best;
  }

  // True when nothing solid lies between the two points (thin props such as tree trunks ignored).
  los(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return true;
    return this.raycast(x0, y0, z0, dx / d, dy / d, dz / d, d - 0.3, true) < 0;
  }

  biomeAt(x, z) {
    const h = this.heightAt(x, z);
    if (this.mapId !== 'island') return h > 6 ? BIOME.HIGHLAND : BIOME.PLAINS;
    if (h < 2.4) return BIOME.BEACH;
    if (h > 48) return BIOME.SNOW;
    if (h > 33) return BIOME.HIGHLAND;
    const s = this.seed;
    const t = fbm(x * 0.0036 + 311.3, z * 0.0036 + 127.7, s + 7, 2);
    const m = fbm(x * 0.0044 + 733.1, z * 0.0044 - 211.9, s + 8, 2);
    if (t > 0.57 && m < 0.5) return BIOME.DESERT;
    if (m > 0.49) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  checksum() {
    let h = 2166136261 >>> 0;
    const H = this.heights;
    for (let i = 0; i < H.length; i += 7) {
      h ^= Math.round(H[i] * 64) & 0xffff;
      h = Math.imul(h, 16777619);
    }
    h ^= this.props.length;
    h = Math.imul(h, 16777619);
    h ^= this.colliders.length;
    return h >>> 0;
  }

  // ---- construction helpers ----------------------------------------------------------------

  _setHeights(fn) {
    const n = this.n;
    for (let j = 0; j < n; j++) {
      const z = -this.half + j * this.cell;
      for (let i = 0; i < n; i++) {
        this.heights[j * n + i] = fn(-this.half + i * this.cell, z);
      }
    }
  }

  // Blend terrain towards a flat pad of radius r around (x, z).
  flatten(x, z, r) {
    let target = 0;
    const off = r * 0.4;
    target += this.heightAt(x, z) * 2;
    target += this.heightAt(x + off, z) + this.heightAt(x - off, z) + this.heightAt(x, z + off) + this.heightAt(x, z - off);
    target /= 6;
    if (target < 2.6) target = 2.6;
    const n = this.n;
    const outer = r * 1.7;
    const i0 = Math.max(0, Math.floor((x - outer + this.half) / this.cell));
    const i1 = Math.min(n - 1, Math.ceil((x + outer + this.half) / this.cell));
    const j0 = Math.max(0, Math.floor((z - outer + this.half) / this.cell));
    const j1 = Math.min(n - 1, Math.ceil((z + outer + this.half) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const vx = -this.half + i * this.cell - x;
        const vz = -this.half + j * this.cell - z;
        const d = Math.sqrt(vx * vx + vz * vz);
        const k = 1 - smoothstep(r, outer, d);
        if (k <= 0) continue;
        const idx = j * n + i;
        this.heights[idx] += (target - this.heights[idx]) * k;
      }
    }
    return target;
  }

  slopeAt(x, z) {
    const e = this.cell;
    const h = this.heightAt(x, z);
    return Math.max(Math.abs(this.heightAt(x + e, z) - h), Math.abs(this.heightAt(x - e, z) - h), Math.abs(this.heightAt(x, z + e) - h), Math.abs(this.heightAt(x, z - e) - h)) / e;
  }

  // quarter: number of 90 degree turns (used for box colliders). angle overrides for round props.
  addProp(type, x, z, quarter = 0, scale = 1, angle = null) {
    const def = PROP_DEFS[type];
    const y = this.heightAt(x, z);
    const rot = angle !== null ? angle : quarter * (Math.PI / 2);
    this.props.push({ type, x, y, z, rot, s: scale });
    if (def.r) {
      this.colliders.push({ circle: true, x, z, r: def.r * scale, hx: 0, hz: 0, base: y - 1, top: y + def.h * scale, stand: !!def.stand, thin: !!def.thin });
    } else if (def.box) {
      const odd = quarter & 1;
      const hx = ((odd ? def.box[1] : def.box[0]) * scale) / 2;
      const hz = ((odd ? def.box[0] : def.box[1]) * scale) / 2;
      this.colliders.push({ circle: false, x, z, r: 0, hx, hz, base: y - 1, top: y + def.h * scale, stand: !!def.stand, thin: false });
    }
  }

  addChest(x, z, rot, type) {
    const y = this.heightAt(x, z);
    const id = this.chests.length;
    this.chests.push({ id, x, y, z, rot, type });
    this.colliders.push({ circle: true, x, z, r: 0.75, hx: 0, hz: 0, base: y - 1, top: y + 0.95, stand: true, thin: true });
    this.clear.push({ x, z, r: 2.5 });
    return id;
  }

  isClear(x, z, pad = 0) {
    const cl = this.clear;
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const r = c.r + pad;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  buildGrid() {
    const g = this.gcell;
    this.grid.fill(null);
    for (let idx = 0; idx < this.colliders.length; idx++) {
      const c = this.colliders[idx];
      const ex = c.circle ? c.r : c.hx;
      const ez = c.circle ? c.r : c.hz;
      const gx0 = Math.max(0, Math.floor((c.x - ex + this.half) / g));
      const gx1 = Math.min(this.gn - 1, Math.floor((c.x + ex + this.half) / g));
      const gz0 = Math.max(0, Math.floor((c.z - ez + this.half) / g));
      const gz1 = Math.min(this.gn - 1, Math.floor((c.z + ez + this.half) / g));
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const k = gz * this.gn + gx;
          (this.grid[k] || (this.grid[k] = [])).push(idx);
        }
      }
    }
  }
}

function rayCollider(c, ox, oy, oz, dx, dy, dz) {
  let t0;
  let t1;
  if (c.circle) {
    const px = ox - c.x;
    const pz = oz - c.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-9) {
      if (px * px + pz * pz > c.r * c.r) return -1;
      t0 = -Infinity;
      t1 = Infinity;
    } else {
      const b = px * dx + pz * dz;
      const disc = b * b - a * (px * px + pz * pz - c.r * c.r);
      if (disc < 0) return -1;
      const sq = Math.sqrt(disc);
      t0 = (-b - sq) / a;
      t1 = (-b + sq) / a;
    }
  } else {
    t0 = -Infinity;
    t1 = Infinity;
    if (Math.abs(dx) < 1e-9) {
      if (ox < c.x - c.hx || ox > c.x + c.hx) return -1;
    } else {
      let a = (c.x - c.hx - ox) / dx;
      let b = (c.x + c.hx - ox) / dx;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < c.z - c.hz || oz > c.z + c.hz) return -1;
    } else {
      let a = (c.z - c.hz - oz) / dz;
      let b = (c.z + c.hz - oz) / dz;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < c.base || oy > c.top) return -1;
  } else {
    let a = (c.base - oy) / dy;
    let b = (c.top - oy) / dy;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  }
  if (t0 > t1 || t1 < 0) return -1;
  return t0 < 0 ? 0 : t0;
}

// ---- generation ------------------------------------------------------------------------------

const worldCache = new Map();

export function generateWorld(mapId, seed, useCache = false) {
  const key = mapId + ':' + (seed >>> 0);
  if (useCache && worldCache.has(key)) return worldCache.get(key);
  const w = new World(mapId, seed);
  if (mapId === 'island') genIsland(w);
  else genArena(w);
  w.buildGrid();
  if (useCache) {
    if (worldCache.size > 3) worldCache.delete(worldCache.keys().next().value);
    worldCache.set(key, w);
  }
  return w;
}

function pickSites(rng, count, minDist, limitR, test, others) {
  const out = [];
  let tries = count * 90;
  while (out.length < count && tries-- > 0) {
    // uniform point in a disc without trigonometry (rejection sampling)
    const x = rng.range(-limitR, limitR);
    const z = rng.range(-limitR, limitR);
    if (x * x + z * z > limitR * limitR) continue;
    if (!test(x, z)) continue;
    let ok = true;
    for (const o of out) {
      const dx = o.x - x;
      const dz = o.z - z;
      if (dx * dx + dz * dz < minDist * minDist) {
        ok = false;
        break;
      }
    }
    if (ok && others) {
      for (const o of others) {
        const dx = o.x - x;
        const dz = o.z - z;
        const md = o.r + minDist * 0.6;
        if (dx * dx + dz * dz < md * md) {
          ok = false;
          break;
        }
      }
    }
    if (ok) out.push({ x, z });
  }
  return out;
}

function genIsland(w) {
  const s = w.seed;
  const half = w.half;
  const rng = new RNG(s ^ 0x9e3779b9);

  w._setHeights((x, z) => {
    const d = Math.sqrt(x * x + z * z) / half;
    const coast = 0.8 + 0.12 * (fbm(x * 0.0045 + 13.7, z * 0.0045 + 4.1, s + 1, 3) * 2 - 1);
    const mask = 1 - smoothstep(coast - 0.2, coast, d);
    if (mask <= 0) return -7;
    const base = fbm(x * 0.0032, z * 0.0032, s + 2, 5);
    const hills = 5 + 30 * base * base;
    const mMask = smoothstep(0.6, 0.74, fbm(x * 0.0021 + 31.2, z * 0.0021 + 77.9, s + 3, 2));
    let ridge = 0;
    if (mMask > 0) {
      const rn = fbm(x * 0.007, z * 0.007, s + 4, 4);
      ridge = 1 - Math.abs(2 * rn - 1);
      ridge *= ridge;
    }
    const detail = (fbm(x * 0.035, z * 0.035, s + 5, 2) - 0.5) * 1.8;
    const lake = smoothstep(0.31, 0.23, fbm(x * 0.006 + 91.4, z * 0.006 + 17.6, s + 6, 2)) * 11;
    const land = hills + mMask * (13 + 46 * ridge) + detail - lake;
    return -7 + (land + 7) * mask;
  });

  const landOk = (x, z) => {
    const h = w.heightAt(x, z);
    return h > 3.2 && h < 44 && w.slopeAt(x, z) < 0.5;
  };
  const sites = [];

  // --- shrines (strongholds with a boss and a legendary chest)
  const shrines = pickSites(rng, 7, 170, half * 0.6, landOk, null);
  const names = { ruins: 0, village: 0, outpost: 0, shrine: 0 };
  const nameOrder = {};
  for (const k of Object.keys(POI_NAMES)) nameOrder[k] = rng.shuffle(POI_NAMES[k].slice());
  const poiName = (kind) => nameOrder[kind][names[kind]++ % nameOrder[kind].length];

  for (const p of shrines) {
    w.flatten(p.x, p.z, 22);
    sites.push({ x: p.x, z: p.z, r: 30 });
    w.clear.push({ x: p.x, z: p.z, r: 20 });
    w.pois.push({ name: poiName('shrine'), kind: 'shrine', x: p.x, z: p.z, r: 26 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      w.addProp('stone', p.x + Math.cos(a) * 11.5, p.z + Math.sin(a) * 11.5, 0, rng.range(0.9, 1.25), rng.range(0, 6.28));
    }
    w.addProp('altar', p.x, p.z, 0, 1);
    w.addChest(p.x, p.z + 2.6, 0, 2);
    const ca = rng.range(0, 6.28);
    w.addChest(p.x + Math.cos(ca) * 15, p.z + Math.sin(ca) * 15, ca, 1);
    const monsters = [{ type: 'warlord', x: p.x, z: p.z - 5 }, { type: 'golem', x: p.x + 6, z: p.z + 3 }];
    const pool = [['stalker', 3], ['spitter', 2], ['wisp', 2]];
    for (let k = 0; k < 4; k++) {
      const a = rng.range(0, 6.28);
      const r = rng.range(5, 10);
      monsters.push({ type: rng.weighted(pool), x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r });
    }
    w.camps.push({ id: w.camps.length, x: p.x, z: p.z, tier: 3, r: 18, monsters });
  }

  // --- structures
  const structKinds = ['ruins', 'ruins', 'ruins', 'ruins', 'village', 'village', 'village', 'outpost', 'outpost', 'outpost'];
  const structs = pickSites(rng, structKinds.length, 130, half * 0.68, landOk, sites);
  structs.forEach((p, i) => {
    const kind = structKinds[i];
    w.flatten(p.x, p.z, 26);
    sites.push({ x: p.x, z: p.z, r: 32 });
    w.clear.push({ x: p.x, z: p.z, r: 25 });
    w.pois.push({ name: poiName(kind), kind, x: p.x, z: p.z, r: 28 });
    if (kind === 'ruins') buildRuins(w, rng, p.x, p.z);
    else if (kind === 'village') buildVillage(w, rng, p.x, p.z);
    else buildOutpost(w, rng, p.x, p.z);
  });

  // --- monster camps
  const camps = pickSites(rng, 54, 60, half * 0.74, landOk, sites);
  for (const p of camps) {
    w.flatten(p.x, p.z, 13);
    const dc = Math.sqrt(p.x * p.x + p.z * p.z) / half;
    const tier = rng.chance(dc < 0.4 ? 0.62 : 0.28) ? 2 : 1;
    w.clear.push({ x: p.x, z: p.z, r: 13 });
    sites.push({ x: p.x, z: p.z, r: 16 });
    w.addProp('campfire', p.x, p.z, 0, 1);
    const tents = tier === 2 ? 3 : 2;
    const a0 = rng.range(0, 6.28);
    for (let k = 0; k < tents; k++) {
      const a = a0 + (k / tents) * Math.PI * 2;
      w.addProp('tent', p.x + Math.cos(a) * 7, p.z + Math.sin(a) * 7, 0, 1, -a + Math.PI / 2);
    }
    const ba = a0 + 0.9;
    w.addProp('banner', p.x + Math.cos(ba) * 3.4, p.z + Math.sin(ba) * 3.4, 0, 1, rng.range(0, 6.28));
    for (let k = 0; k < 2; k++) {
      const q = rng.int(0, 1);
      const a = a0 + 0.5 + k * Math.PI + rng.range(-0.3, 0.3);
      w.addProp('spikes', p.x + Math.cos(a) * 11, p.z + Math.sin(a) * 11, q, 1);
    }
    if (rng.chance(0.6)) w.addProp('crate', p.x + rng.range(-5, 5), p.z + rng.range(-5, 5), 0, 1);
    const monsters = [];
    let pool;
    let count;
    if (tier === 1) {
      pool = [['gloop', 3], ['stalker', 2], ['spitter', 1]];
      count = rng.int(3, 4);
    } else {
      pool = [['gloop', 2], ['stalker', 3], ['spitter', 2], ['wisp', 2]];
      count = rng.int(4, 5);
      if (rng.chance(0.45)) monsters.push({ type: 'golem', x: p.x + rng.range(-3, 3), z: p.z + rng.range(-3, 3) });
    }
    for (let k = 0; k < count; k++) {
      const a = rng.range(0, 6.28);
      const r = rng.range(3, 9);
      monsters.push({ type: rng.weighted(pool), x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r });
    }
    if (tier === 2 || rng.chance(0.5)) {
      const a = a0 + 2.4;
      w.addChest(p.x + Math.cos(a) * 4.2, p.z + Math.sin(a) * 4.2, a, tier === 2 ? 1 : 0);
    }
    w.camps.push({ id: w.camps.length, x: p.x, z: p.z, tier, r: 14, monsters });
  }

  // --- loose chests
  const loose = pickSites(rng, 90, 34, half * 0.78, (x, z) => landOk(x, z) && w.isClear(x, z, 4), null);
  for (const p of loose) w.addChest(p.x, p.z, rng.range(0, 6.28), rng.chance(0.12) ? 1 : 0);

  // --- spawn points
  w.spawns = pickSites(rng, 64, 40, half * 0.72, (x, z) => landOk(x, z) && w.isClear(x, z, 16), null);

  // --- vegetation and rocks (stateless per-cell hashing)
  scatter(w, s);
}

function scatter(w, s) {
  const half = w.half;
  const treeStep = 6;
  const nT = Math.floor(w.size / treeStep);
  for (let j = 0; j < nT; j++) {
    for (let i = 0; i < nT; i++) {
      const jx = hash2(i, j, s + 21);
      const jz = hash2(i, j, s + 22);
      const x = -half + (i + 0.15 + jx * 0.7) * treeStep;
      const z = -half + (j + 0.15 + jz * 0.7) * treeStep;
      const h = w.heightAt(x, z);
      if (h < 1.6) continue;
      const biome = w.biomeAt(x, z);
      const clump = smoothstep(0.38, 0.62, fbm(x * 0.021 + 5.5, z * 0.021 + 8.8, s + 23, 2));
      let density = 0;
      let type = 'oak';
      const pickRoll = hash2(i, j, s + 24);
      if (biome === BIOME.FOREST) {
        density = 0.26 + 0.5 * clump;
        type = pickRoll < 0.55 ? 'pine' : 'oak';
      } else if (biome === BIOME.PLAINS) {
        density = 0.02 + 0.16 * clump * clump;
        type = pickRoll < 0.8 ? 'oak' : 'pine';
      } else if (biome === BIOME.DESERT) {
        density = 0.035 + 0.05 * clump;
        type = pickRoll < 0.6 ? 'cactus' : pickRoll < 0.85 ? 'dead' : 'palm';
      } else if (biome === BIOME.BEACH) {
        density = h > 1.9 ? 0.06 : 0;
        type = 'palm';
      } else if (biome === BIOME.HIGHLAND) {
        density = 0.05 + 0.1 * clump;
        type = pickRoll < 0.7 ? 'pine' : 'dead';
      } else {
        density = 0.03;
        type = 'pine';
      }
      if (hash2(i, j, s + 25) >= density) continue;
      if (w.slopeAt(x, z) > 0.9) continue;
      if (!w.isClear(x, z, 1.5)) continue;
      const sc = 0.8 + hash2(i, j, s + 26) * 0.65;
      w.addProp(type, x, z, 0, sc, hash2(i, j, s + 27) * 6.283);
    }
  }
  const rockStep = 15;
  const nR = Math.floor(w.size / rockStep);
  for (let j = 0; j < nR; j++) {
    for (let i = 0; i < nR; i++) {
      const x = -half + (i + 0.1 + hash2(i, j, s + 31) * 0.8) * rockStep;
      const z = -half + (j + 0.1 + hash2(i, j, s + 32) * 0.8) * rockStep;
      const h = w.heightAt(x, z);
      if (h < 0.4) continue;
      const biome = w.biomeAt(x, z);
      const density = biome === BIOME.HIGHLAND || biome === BIOME.SNOW ? 0.34 : biome === BIOME.DESERT ? 0.2 : 0.11;
      if (hash2(i, j, s + 33) >= density) continue;
      if (!w.isClear(x, z, 3)) continue;
      const big = hash2(i, j, s + 34) < 0.35;
      w.addProp(big ? 'boulder' : 'rock', x, z, 0, 0.8 + hash2(i, j, s + 35) * 0.8, hash2(i, j, s + 36) * 6.283);
    }
  }
  const bushStep = 6;
  const nB = Math.floor(w.size / bushStep);
  for (let j = 0; j < nB; j++) {
    for (let i = 0; i < nB; i++) {
      const roll = hash2(i, j, s + 43);
      if (roll >= 0.2) continue;
      const x = -half + (i + hash2(i, j, s + 41)) * bushStep;
      const z = -half + (j + hash2(i, j, s + 42)) * bushStep;
      const h = w.heightAt(x, z);
      if (h < 2.2 || h > 40) continue;
      const biome = w.biomeAt(x, z);
      if (biome === BIOME.DESERT && roll > 0.04) continue;
      if (!w.isClear(x, z, 0)) continue;
      const kind = roll < 0.07 ? 'bush' : roll < 0.16 ? 'grass' : 'flower';
      if (kind === 'flower' && biome !== BIOME.PLAINS) continue;
      w.addProp(kind, x, z, 0, 0.8 + hash2(i, j, s + 44) * 0.7, hash2(i, j, s + 45) * 6.283);
    }
  }
}

function buildRuins(w, rng, cx, cz) {
  for (const sz of [-8, 8]) {
    for (let x = -8; x <= 8; x += 4) {
      if (rng.chance(0.35)) continue;
      w.addProp('wall', cx + x, cz + sz, 0, 1);
    }
  }
  for (const sx of [-10, 10]) {
    for (let z = -6; z <= 6; z += 4) {
      if (rng.chance(0.4)) continue;
      w.addProp('wall', cx + sx, cz + z, 1, 1);
    }
  }
  for (const [px, pz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) {
    if (rng.chance(0.8)) w.addProp('pillar', cx + px, cz + pz, 0, rng.range(0.8, 1.1), rng.range(0, 6.28));
  }
  for (let k = 0; k < 5; k++) {
    const a = rng.range(0, 6.28);
    const r = rng.range(13, 22);
    w.addProp('rock', cx + Math.cos(a) * r, cz + Math.sin(a) * r, 0, rng.range(0.7, 1.3), rng.range(0, 6.28));
  }
  w.addChest(cx + rng.range(-1.5, 1.5), cz + rng.range(-1.5, 1.5), rng.range(0, 6.28), 1);
  w.addChest(cx - 7 + rng.range(-1, 1), cz + rng.pick([-5, 5]), rng.range(0, 6.28), 0);
  w.addChest(cx + 7 + rng.range(-1, 1), cz + rng.pick([-5, 5]), rng.range(0, 6.28), 0);
  if (rng.chance(0.6)) w.addChest(cx + rng.range(-16, 16), cz + rng.pick([-13, 13]), rng.range(0, 6.28), 0);
}

function buildVillage(w, rng, cx, cz) {
  w.addProp('well', cx, cz, 0, 1);
  const huts = rng.int(4, 5);
  const a0 = rng.range(0, 6.28);
  for (let k = 0; k < huts; k++) {
    const a = a0 + (k / huts) * Math.PI * 2;
    const r = rng.range(14, 18);
    const hx = cx + Math.cos(a) * r;
    const hz = cz + Math.sin(a) * r;
    // face the well: choose the quarter turn whose door (model -Z / +Z axis) points inward
    const q = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 3 : 1) : Math.sin(a) > 0 ? 2 : 0;
    w.addProp('hut', hx, hz, q, 1);
    if (rng.chance(0.75)) {
      const ca = a + 0.55;
      w.addChest(cx + Math.cos(ca) * (r - 1), cz + Math.sin(ca) * (r - 1), ca + Math.PI, 0);
    }
  }
  for (let k = 0; k < 6; k++) {
    const a = rng.range(0, 6.28);
    const r = rng.range(4, 11);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (!w.isClear(x, z, 0.5) && r < 5) continue;
    if (rng.chance(0.5)) w.addProp('crate', x, z, 0, rng.range(0.85, 1.15));
    else w.addProp('barrel', x, z, 0, 1, rng.range(0, 6.28));
  }
  w.addChest(cx + 3.2, cz + 0.5, 1.2, 1);
}

function buildOutpost(w, rng, cx, cz) {
  w.addProp('tower', cx + rng.pick([-4, 4]), cz + rng.pick([-4, 4]), 0, 1);
  for (const sz of [-11, 11]) {
    for (let x = -8; x <= 8; x += 4) {
      if (x === 0 || rng.chance(0.2)) continue;
      w.addProp('spikes', cx + x, cz + sz, 0, 1);
    }
  }
  for (const sx of [-11, 11]) {
    for (let z = -8; z <= 8; z += 4) {
      if (z === 0 || rng.chance(0.2)) continue;
      w.addProp('spikes', cx + sx, cz + z, 1, 1);
    }
  }
  for (let k = 0; k < 7; k++) {
    const x = cx + rng.range(-8, 8);
    const z = cz + rng.range(-8, 8);
    if (Math.abs(x - cx) < 6.5 && Math.abs(z - cz) < 6.5 && Math.abs(x - cx) > 1.5 && Math.abs(z - cz) > 1.5) continue;
    if (rng.chance(0.6)) w.addProp('crate', x, z, 0, rng.range(0.85, 1.2));
    else w.addProp('barrel', x, z, 0, 1, rng.range(0, 6.28));
  }
  w.addChest(cx, cz, rng.range(0, 6.28), 1);
  w.addChest(cx + rng.pick([-8, 8]), cz + rng.range(-2, 2), rng.range(0, 6.28), 0);
  w.addChest(cx + rng.range(-2, 2), cz + rng.pick([-8, 8]), rng.range(0, 6.28), 0);
}

function genArena(w) {
  const s = w.seed;
  const rng = new RNG(s ^ 0x51ed270b);
  w._setHeights((x, z) => {
    const d = Math.sqrt(x * x + z * z);
    const floor = 3 + (fbm(x * 0.03, z * 0.03, s + 1, 3) - 0.5) * 1.4;
    return floor + smoothstep(55, 63, d) * 20;
  });
  const a0 = rng.range(0, Math.PI / 3);
  for (let k = 0; k < 6; k++) {
    const a = a0 + (k / 6) * Math.PI * 2;
    w.addProp('boulder', Math.cos(a) * 21, Math.sin(a) * 21, 0, rng.range(1.0, 1.4), rng.range(0, 6.28));
  }
  w.addProp('wall', 30, -4, 1, 1);
  w.addProp('wall', 30, 4, 1, 1);
  w.addProp('wall', -30, -4, 1, 1);
  w.addProp('wall', -30, 4, 1, 1);
  w.addProp('wall', -4, 33, 0, 1);
  w.addProp('wall', 4, 33, 0, 1);
  w.addProp('wall', -4, -33, 0, 1);
  w.addProp('wall', 4, -33, 0, 1);
  for (const [px, pz] of [[7, 7], [-7, 7], [7, -7], [-7, -7]]) w.addProp('pillar', px, pz, 0, 1.1, rng.range(0, 6.28));
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, 6.28);
    const r = rng.range(12, 46);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) > 34 && Math.abs(z) < 8) continue;
    if (rng.chance(0.5)) w.addProp('crate', x, z, 0, rng.range(0.9, 1.25));
    else w.addProp('rock', x, z, 0, rng.range(0.8, 1.2), rng.range(0, 6.28));
  }
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const r = rng.range(64, 70);
    w.addProp(rng.chance(0.7) ? 'pine' : 'boulder', Math.cos(a) * r, Math.sin(a) * r, 0, rng.range(0.9, 1.5), rng.range(0, 6.28));
  }
  w.pois.push({ name: 'The Pit', kind: 'arena', x: 0, z: 0, r: 55 });
  w.spawns = [{ x: -40, z: 0 }, { x: 40, z: 0 }];
}

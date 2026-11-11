// Value noise built only from integer hashing and polynomial interpolation, so the result is
// bit-identical on the server (Node) and in every browser. Do not add Math.sin/cos/pow here.
import { hash2 } from './rng.js';

export function vnoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise in [0, 1].
export function fbm(x, z, seed, octaves) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(fx, fz, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    fx = fx * 2 + 17.3;
    fz = fz * 2 - 9.1;
  }
  return sum / norm;
}

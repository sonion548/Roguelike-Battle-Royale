// Character controller shared by the client (local player) and the server (bots, monsters).
//
// state `s`: { x, y, z, vx, vy, vz, grounded, airJumps, swim,
//              dashT, dashVx, dashVy, dashVz, dashFly, radius?, height? }
// input:     { mx, mz  : desired direction in world space (unit length or zero),
//              speed   : max ground speed, canMove, jump (bool), extraJumps, jumpMul }
import { GRAVITY, JUMP_SPEED, PLAYER_RADIUS, PLAYER_HEIGHT, WATER_LEVEL, SWIM_DEPTH } from './constants.js';

const tmp = { x: 0, z: 0 };

export function makeMoveState(x, y, z) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, airJumps: 0, swim: false, dashT: 0, dashVx: 0, dashVy: 0, dashVz: 0, dashFly: false };
}

// Forced movement (dashes, charges, leaps with a fixed arc).
export function startDash(s, vx, vy, vz, dur, fly) {
  s.dashT = dur;
  s.dashVx = vx;
  s.dashVy = vy;
  s.dashVz = vz;
  s.dashFly = !!fly;
  if (fly || vy > 0) {
    s.grounded = false;
    s.vy = vy;
  }
}

export function addImpulse(s, ix, iy, iz) {
  s.vx += ix;
  s.vz += iz;
  if (iy > 0) {
    s.vy = Math.max(s.vy, 0) + iy;
    s.grounded = false;
  }
}

export function stepMove(s, inp, dt, world) {
  const R = s.radius || PLAYER_RADIUS;
  const H = s.height || PLAYER_HEIGHT;
  const dashing = s.dashT > 0;

  if (dashing) {
    s.dashT -= dt;
    s.vx = s.dashVx;
    s.vz = s.dashVz;
    if (s.dashFly) s.vy = s.dashVy;
    if (s.dashT <= 0) {
      s.vx *= 0.35;
      s.vz *= 0.35;
      if (s.dashFly) s.vy = Math.min(s.vy, 2);
      s.dashFly = false;
    }
  } else {
    const want = inp.canMove ? inp.speed : 0;
    const tx = inp.mx * want;
    const tz = inp.mz * want;
    let dvx = tx - s.vx;
    let dvz = tz - s.vz;
    const dl = Math.sqrt(dvx * dvx + dvz * dvz);
    let accel = s.grounded ? 75 : 24;
    if (!s.grounded && want === 0) accel = 6; // keep momentum in the air
    const maxDv = accel * dt;
    if (dl > maxDv) {
      dvx *= maxDv / dl;
      dvz *= maxDv / dl;
    }
    s.vx += dvx;
    s.vz += dvz;
    if (inp.jump && inp.canMove) {
      if (s.grounded) {
        s.vy = JUMP_SPEED * (inp.jumpMul || 1);
        s.grounded = false;
      } else if (inp.jumpEdge && s.airJumps < (inp.extraJumps || 0)) {
        s.airJumps++;
        s.vy = JUMP_SPEED * (inp.jumpMul || 1);
      }
    }
  }
  if (!s.grounded && !(dashing && s.dashFly)) s.vy -= GRAVITY * dt;
  if (s.vy < -60) s.vy = -60;

  const dist = Math.sqrt(s.vx * s.vx + s.vz * s.vz) * dt;
  const steps = Math.max(1, Math.min(8, Math.ceil(dist / 0.4)));
  const h = dt / steps;
  const lim = world.half - 2;

  for (let k = 0; k < steps; k++) {
    let nx = s.x + s.vx * h;
    let nz = s.z + s.vz * h;
    if (nx < -lim) nx = -lim;
    else if (nx > lim) nx = lim;
    if (nz < -lim) nz = -lim;
    else if (nz > lim) nz = lim;
    tmp.x = nx;
    tmp.z = nz;
    world.collideCircle(tmp, R, s.y, H);
    nx = tmp.x;
    nz = tmp.z;

    // Slopes: refuse to walk up anything steeper than ~56 degrees.
    let gh = world.groundAt(nx, nz, s.y);
    const mdx = nx - s.x;
    const mdz = nz - s.z;
    const md = Math.sqrt(mdx * mdx + mdz * mdz);
    if (gh - s.y > 0.12 + md * 1.5 && md > 1e-5) {
      const gx = world.groundAt(nx, s.z, s.y);
      const gz = world.groundAt(s.x, nz, s.y);
      const okX = gx - s.y <= 0.12 + Math.abs(mdx) * 1.5;
      const okZ = gz - s.y <= 0.12 + Math.abs(mdz) * 1.5;
      if (okX && (!okZ || gx <= gz)) {
        nz = s.z;
        gh = gx;
      } else if (okZ) {
        nx = s.x;
        gh = gz;
      } else {
        nx = s.x;
        nz = s.z;
        gh = world.groundAt(nx, nz, s.y);
      }
    }

    let ny = s.y + s.vy * h;
    if (ny <= gh && s.vy <= 0) {
      ny = gh;
      s.vy = 0;
      s.grounded = true;
      s.airJumps = 0;
    } else if (s.grounded && s.vy <= 0) {
      if (gh >= ny - 0.6) ny = gh;
      else s.grounded = false;
    } else if (ny < gh) {
      // rising into a slope
      ny = gh;
      if (s.vy < 0) s.vy = 0;
    }
    s.x = nx;
    s.y = ny;
    s.z = nz;
  }
  s.swim = s.y <= WATER_LEVEL - SWIM_DEPTH + 0.05 && world.heightAt(s.x, s.z) < WATER_LEVEL - SWIM_DEPTH;
}

// Constants shared by the server and the client.

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export const WATER_LEVEL = 0;
export const SWIM_DEPTH = 1.3; // feet sink this far below the surface while swimming

export const PLAYER_RADIUS = 0.5;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.55;
export const MUZZLE_HEIGHT = 1.3;

export const GRAVITY = 28;
export const JUMP_SPEED = 10.5;
export const SPRINT_MUL = 1.38;
export const SPRINT_DELAY = 0.7; // seconds after attacking before auto-sprint resumes

export const MAX_LEVEL = 20;
export const TIER_UNLOCK_LEVEL = [0, 2, 4, 7, 11]; // level needed before tier N upgrades are offered

export const SLOT_NAMES = ['Primary', 'Secondary', 'Utility', 'Special'];
export const SLOT_KEYS = ['LMB', 'RMB', 'SHIFT', 'R'];

export const TIER_NUMERALS = ['', 'I', 'II', 'III', 'IV'];
export const TIER_LABELS = ['', 'Common', 'Rare', 'Epic', 'Legendary'];
export const TIER_COLORS = ['', '#b8c2cc', '#4aa3ff', '#b65cff', '#ffb53d'];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_COLORS = { common: '#d7dde3', rare: '#4aa3ff', epic: '#b65cff', legendary: '#ffb53d' };
export const RARITY_LABELS = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

// Input button bitmask sent by the client.
export const BTN = { PRIMARY: 1, SECONDARY: 2, UTILITY: 4, SPECIAL: 8, INTERACT: 16 };

// Entity kinds used in snapshots.
export const KIND = { PLAYER: 0, MONSTER: 1, PROJECTILE: 2, ZONE: 3, DEPLOY: 4, PICKUP: 5 };

// Player life states.
export const LIFE = { ALIVE: 0, DOWNED: 1, DEAD: 2 };

export const MASTERY_WINS = 10;

export const MODES = {
  solo: { id: 'solo', name: 'Solo', blurb: '50 players. Every survivor for themselves.', teamSize: 1, players: 50, map: 'island', br: true },
  duo: { id: 'duo', name: 'Duos', blurb: '25 teams of two.', teamSize: 2, players: 50, map: 'island', br: true },
  trio: { id: 'trio', name: 'Trios', blurb: '16 teams of three.', teamSize: 3, players: 48, map: 'island', br: true },
  squad: { id: 'squad', name: 'Squads', blurb: '12 teams of four.', teamSize: 4, players: 48, map: 'island', br: true },
  duel: { id: 'duel', name: '1v1 Duel', blurb: 'Small arena. First to 4 rounds. Draft a powerup and an item every round.', teamSize: 1, players: 2, map: 'arena', br: false, roundsToWin: 4 },
};

export const MAPS = {
  island: { id: 'island', size: 1024, cell: 4, stormRadius: 480 },
  arena: { id: 'arena', size: 144, cell: 2, stormRadius: 54 },
};

// Storm phases for the island: wait (s), shrink (s), radius as a fraction of the start radius,
// damage per second as a fraction of max HP plus a flat amount.
export const STORM_PHASES = [
  { wait: 95, shrink: 55, frac: 0.6, pct: 0.01, flat: 1 },
  { wait: 60, shrink: 45, frac: 0.38, pct: 0.015, flat: 2 },
  { wait: 50, shrink: 40, frac: 0.22, pct: 0.02, flat: 3 },
  { wait: 40, shrink: 35, frac: 0.11, pct: 0.03, flat: 5 },
  { wait: 30, shrink: 30, frac: 0.04, pct: 0.045, flat: 7 },
  { wait: 18, shrink: 28, frac: 0.0, pct: 0.07, flat: 10 },
];

// XP needed to go from `level` to `level + 1`.
export function xpForLevel(level) {
  return Math.round(40 + 26 * Math.pow(Math.max(0, level - 1), 1.3));
}

export const CHEST_TYPES = [
  { id: 0, name: 'Chest', cost: 25, odds: { common: 0.78, rare: 0.2, epic: 0.02, legendary: 0 } },
  { id: 1, name: 'Large Chest', cost: 60, odds: { common: 0, rare: 0.74, epic: 0.23, legendary: 0.03 } },
  { id: 2, name: 'Legendary Chest', cost: 140, odds: { common: 0, rare: 0, epic: 0.68, legendary: 0.32 } },
];

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

import { feature } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';

/**
 * BUDDY — virtual terminal pet.
 *
 * Port of the Claude-Code "BUDDY" module (src/buddy/). The original had 18
 * species × 5 rarities × 1% shiny chance, derived deterministically from a
 * user-id + salt. We keep the behavior but expose it as an opt-in cosmetic
 * layer. Disabled unless DOGE_FEATURE_BUDDY=true.
 */

const SPECIES = [
  'gosling', 'kitten', 'dragon', 'octopus', 'owl', 'goose', 'bull', 'ghost',
  'unicorn', 'dolphin', 'cactus', 'robot', 'bunny', 'mushroom', 'fox', 'cat',
  'slime', 'phoenix',
];
const RARITIES: Array<{ name: string; threshold: number }> = [
  { name: 'common', threshold: 0.6 },
  { name: 'uncommon', threshold: 0.85 },
  { name: 'rare', threshold: 0.95 },
  { name: 'epic', threshold: 0.99 },
  { name: 'legendary', threshold: 1.0 },
];
const SALT = 'friend-2026-401';

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Buddy {
  userId: string;
  species: string;
  rarity: string;
  shiny: boolean;
}

export function rollBuddy(userId: string): Buddy {
  const rng = mulberry32(fnv1a(userId + ':' + SALT));
  const speciesIndex = Math.floor(rng() * SPECIES.length);
  const rarityRoll = rng();
  const rarity = RARITIES.find((r) => rarityRoll <= r.threshold)?.name ?? 'common';
  const shiny = rng() < 0.01;
  return { userId, species: SPECIES[speciesIndex] ?? 'kitten', rarity, shiny };
}

export function buddyCard(b: Buddy): string {
  return [
    '┌─────────────────────────────┐',
    `│ 🐾 ${b.species.padEnd(24)} │`,
    `│    rarity : ${b.rarity.padEnd(15)} │`,
    `│    shiny  : ${(b.shiny ? '✨ yes' : 'no').padEnd(15)} │`,
    `│    id     : ${b.userId.slice(0, 15).padEnd(15)} │`,
    '└─────────────────────────────┘',
  ].join('\n');
}

export function activateBuddy(userId: string): Buddy | null {
  if (!feature('BUDDY')) return null;
  const b = rollBuddy(userId);
  logger.info('buddy.activated', { species: b.species, rarity: b.rarity, shiny: b.shiny });
  return b;
}

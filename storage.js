// Saves progress on the phone (a small JSON file), so stars, streak and tricky words survive
// closing the app. Everything is wrapped in try/catch: if saving fails the app still works.
import { File, Paths } from 'expo-file-system';
import { STAGE_COUNT } from './sentences';

const FILE_NAME = 'speak-it-right-progress.json';
export const DAILY_GOAL = 5;        // sentences per day
export const MASTER_AFTER = 2;      // correct readings needed to clear a tricky word
const MAX_TRICKY = 40;

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const emptyStars = () => new Array(STAGE_COUNT).fill(0);

export const defaultProgress = () => ({
  xp: 0,
  streak: { count: 0, lastDay: '' },
  today: { day: todayKey(), done: 0 },
  stars: { Beginner: emptyStars(), Intermediate: emptyStars(), Advanced: emptyStars() },
  tricky: {},            // word -> { misses, wins }
  settings: { mode: 'guided', passMark: 0.85, phonetics: true, slowVoice: false },
});

// Fill in anything missing, so old save files keep working after an update
function normalize(saved) {
  const base = defaultProgress();
  if (!saved || typeof saved !== 'object') return base;
  const out = { ...base, ...saved };
  out.streak = { ...base.streak, ...(saved.streak || {}) };
  out.settings = { ...base.settings, ...(saved.settings || {}) };
  out.tricky = saved.tricky && typeof saved.tricky === 'object' ? saved.tricky : {};
  out.stars = { ...base.stars };
  for (const key of Object.keys(base.stars)) {
    const row = Array.isArray(saved.stars?.[key]) ? saved.stars[key] : [];
    out.stars[key] = base.stars[key].map((_, i) => Math.max(0, Math.min(3, Number(row[i]) || 0)));
  }
  if (!saved.today || saved.today.day !== todayKey()) out.today = { day: todayKey(), done: 0 };
  // A streak is lost when a whole day was skipped
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  if (out.streak.lastDay !== todayKey() && out.streak.lastDay !== yesterday) out.streak.count = 0;
  return out;
}

export function loadProgress() {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return defaultProgress();
    return normalize(JSON.parse(file.textSync()));
  } catch (e) {
    console.warn('Could not load progress', e);
    return defaultProgress();
  }
}

export function saveProgress(progress) {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) file.create();
    file.write(JSON.stringify(progress));
  } catch (e) {
    console.warn('Could not save progress', e);
  }
}

// ───────────── Pure helpers: take progress, return new progress ─────────────

/** A sentence was read well enough to pass. */
export function recordPass(progress, { diffKey, stageIndex, stars, xp }) {
  const day = todayKey();
  const p = { ...progress, xp: progress.xp + xp };
  const row = [...p.stars[diffKey]];
  row[stageIndex] = Math.max(row[stageIndex], stars);
  p.stars = { ...p.stars, [diffKey]: row };
  p.today = p.today.day === day ? { day, done: p.today.done + 1 } : { day, done: 1 };
  if (p.streak.lastDay !== day) p.streak = { count: p.streak.count + 1, lastDay: day };
  return p;
}

/** Update the tricky-word list after a reading. */
export function recordWords(progress, { missed = [], readWell = [] }) {
  const tricky = { ...progress.tricky };
  for (const w of missed) {
    if (!w) continue;
    const cur = tricky[w] || { misses: 0, wins: 0 };
    tricky[w] = { misses: cur.misses + 1, wins: 0 };
  }
  for (const w of readWell) {
    if (!tricky[w]) continue;
    const wins = tricky[w].wins + 1;
    if (wins >= MASTER_AFTER) delete tricky[w];
    else tricky[w] = { ...tricky[w], wins };
  }
  // keep the list short: drop the least-missed words first
  const keys = Object.keys(tricky);
  if (keys.length > MAX_TRICKY) {
    keys.sort((a, b) => tricky[a].misses - tricky[b].misses)
      .slice(0, keys.length - MAX_TRICKY)
      .forEach((k) => delete tricky[k]);
  }
  return { ...progress, tricky };
}

export const totalStars = (progress, diffKey) => progress.stars[diffKey].reduce((a, b) => a + b, 0);

/** First level without a star (where to continue), or 0 when everything is done. */
export const nextStage = (progress, diffKey) => {
  const i = progress.stars[diffKey].findIndex((s) => s === 0);
  return i === -1 ? 0 : i;
};

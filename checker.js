// Pure JavaScript sentence checker (no native code), so it is easy to test and tweak.
//
// How it works:
//  1. The target sentence and the recognized speech are turned into lowercase word tokens.
//  2. The tokens are aligned, so EVERY target word gets one of four marks:
//       'ok'      read correctly (same word, or a word that sounds identical: to / two)
//       'close'   nearly right (plural / tense slip such as "plants" for "plant", or one sound off)
//       'wrong'   a different word was said, or the word was not clear
//       'missing' the word was skipped
//  3. Each mark earns credit (ok = 1, close = part, wrong / missing = 0). The score is the
//     share of credit earned, and the reading passes when the score reaches the pass mark.
import { HOMOPHONES } from './phonetics';

// ───────────── Settings you can tune ─────────────
export const CREDIT = { ok: 1, inflection: 0.85, similar: 0.6, wrong: 0, missing: 0 };
const SIMILAR_MIN = 0.6;        // letter similarity (0..1) needed to call two words "close"
const EXTRA_WORD_PENALTY = 0.5; // each unexpected extra word costs half a word (after one free one)

// Spoken two-word forms that count as one contraction in the target sentence.
const CONTRACTION_PAIRS = {
  'they are': 'theyre', 'could not': 'couldnt', 'can not': 'cant', 'will not': 'wont',
  'do not': 'dont', 'does not': 'doesnt', 'did not': 'didnt', 'is not': 'isnt',
  'are not': 'arent', 'was not': 'wasnt', 'were not': 'werent', 'would not': 'wouldnt',
  'should not': 'shouldnt', 'has not': 'hasnt', 'have not': 'havent', 'i am': 'im',
  'we are': 'were', 'you are': 'youre', 'i will': 'ill', 'i have': 'ive', 'i would': 'id',
  'let us': 'lets', 'there is': 'theres', 'what is': 'whats', 'that is': 'thats',
};

// Noise the recognizer likes to add. Never required, never punished.
const FILLERS = new Set(['uh', 'um', 'umm', 'er', 'ah', 'hmm', 'mm', 'huh', 'eh']);
const WEAK_EXTRAS = new Set(['the', 'a', 'an', 'and', 'of']);
export const UNCLEAR = '?'; // stands for "[unk]" = something was said, but it was not a known word

// A token is a lowercase word without punctuation OR apostrophes: "couldn't" -> "couldnt"
const toToken = (w) => w.toLowerCase().replace(/[^a-z]/g, '');

// Homophone table with apostrophes removed, so it matches our tokens
const HOMO = {};
for (const [word, list] of Object.entries(HOMOPHONES)) {
  const key = toToken(word);
  HOMO[key] = HOMO[key] || new Set();
  list.forEach((x) => HOMO[key].add(toToken(x)));
}

/** Target sentence -> display words + comparable tokens (w = index of the display word) */
export function analyzeTarget(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const tokens = [];
  words.forEach((word, w) => {
    const t = toToken(word);
    if (t) tokens.push({ t, w });
  });
  return { words, tokens };
}

/**
 * Recognized text -> tokens. Fillers are removed, "[unk]" becomes UNCLEAR ('?'), and two-word
 * forms such as "they are" are merged when the target sentence contains the contraction.
 */
export function tokenizeHeard(text, targetTokens = []) {
  const wanted = new Set(targetTokens.map((x) => x.t));
  const raw = (text || '')
    .replace(/\[unk\]/gi, ` ${UNCLEAR} `)
    .split(/\s+/)
    .map((w) => (w === UNCLEAR ? UNCLEAR : toToken(w)))
    .filter((t) => t && (!FILLERS.has(t) || wanted.has(t)));

  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const merged = CONTRACTION_PAIRS[`${raw[i]} ${raw[i + 1]}`];
    if (merged && wanted.has(merged)) {
      out.push(merged);
      i++;
    } else if (raw[i] === UNCLEAR && out[out.length - 1] === UNCLEAR) {
      // several unclear sounds in a row count as one
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

/** Real words only (no '?'), handy for "did we hear anything at all?" */
export const heardWords = (text) => tokenizeHeard(text).filter((t) => t !== UNCLEAR);

const sameSound = (t, h) =>
  t === h || Boolean(HOMO[t] && HOMO[t].has(h)) || Boolean(HOMO[h] && HOMO[h].has(t));

// Plain edit distance between two short words
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s|d)$/, '') : w.replace(/s$/, ''));

/**
 * How well does the heard word match the target word?
 * @returns {{ mark: 'ok'|'close'|'wrong', credit: number }}
 */
export function compareWords(target, heard) {
  if (heard === UNCLEAR) return { mark: 'wrong', credit: CREDIT.wrong };
  if (sameSound(target, heard)) return { mark: 'ok', credit: CREDIT.ok };
  // plural / tense slips: plant ~ plants, discover ~ discovered
  const st = stem(target);
  const sh = stem(heard);
  if (st.length >= 3 && st === sh) return { mark: 'close', credit: CREDIT.inflection };
  // one sound off: mat ~ map, sat ~ set
  const longest = Math.max(target.length, heard.length);
  if (longest >= 3 && 1 - editDistance(target, heard) / longest >= SIMILAR_MIN) {
    return { mark: 'close', credit: CREDIT.similar };
  }
  return { mark: 'wrong', credit: CREDIT.wrong };
}

/**
 * Align the heard tokens with the target tokens (weighted edit-distance alignment).
 * Returns one entry per target token plus the extra words that were heard.
 */
export function align(targetTokens, heardTokens) {
  const n = targetTokens.length;
  const m = heardTokens.length;
  const cmp = (i, j) => compareWords(targetTokens[i].t, heardTokens[j]);
  const subCost = (i, j) => 1 - cmp(i, j).credit; // 0 = perfect match, 1 = different word
  const INS = 0.9; // an extra heard word
  const DEL = 1;   // a skipped target word

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i * DEL;
  for (let j = 1; j <= m; j++) dp[0][j] = j * INS;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j - 1] + subCost(i - 1, j - 1),
        dp[i - 1][j] + DEL,
        dp[i][j - 1] + INS
      );
    }
  }

  const status = new Array(n);
  const extras = [];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && near(dp[i][j], dp[i - 1][j - 1] + subCost(i - 1, j - 1))) {
      const c = cmp(i - 1, j - 1);
      status[i - 1] = { s: c.mark, credit: c.credit, heard: heardTokens[j - 1] };
      i--; j--;
    } else if (i > 0 && near(dp[i][j], dp[i - 1][j] + DEL)) {
      status[i - 1] = { s: 'missing', credit: CREDIT.missing, heard: null };
      i--;
    } else {
      extras.unshift(heardTokens[j - 1]);
      j--;
    }
  }
  return { status, extras };
}

/**
 * Compare what was heard with the target sentence.
 * @param {string} sentence   the sentence the person should read
 * @param {string} heardText  what the speech recognizer heard
 * @param {{passMark?: number}} opts  score needed to pass, 0..1 (1 = every word exactly right)
 * @returns {{passed, score, percent, wordStatus, wordHeard, wrongWords, closeWords, extraWords, heardTokens}}
 *   wordStatus has one entry per DISPLAY word: 'ok' | 'close' | 'wrong' | 'missing'
 *   wordHeard  has what was heard in place of each display word (null when nothing / unclear)
 */
export function evaluate(sentence, heardText, { passMark = 0.85 } = {}) {
  const { words, tokens } = analyzeTarget(sentence);
  const heardTokens = tokenizeHeard(heardText, tokens);
  const { status, extras } = align(tokens, heardTokens);

  const rank = { ok: 0, close: 1, missing: 2, wrong: 3 };
  const wordStatus = words.map(() => 'ok');
  const wordHeard = words.map(() => null);
  tokens.forEach((tok, k) => {
    const st = status[k];
    if (rank[st.s] > rank[wordStatus[tok.w]]) wordStatus[tok.w] = st.s;
    if (st.heard && st.heard !== UNCLEAR && st.s !== 'ok') wordHeard[tok.w] = st.heard;
  });

  // Extra words: repeating a word of the sentence (a self-correction) is free, so are tiny
  // words and unclear sounds. Other extra words cost a little, after one free one.
  const targetSet = new Set(tokens.map((x) => x.t));
  const strongExtras = extras.filter((e) => e !== UNCLEAR && !WEAK_EXTRAS.has(e) && !targetSet.has(e));
  const penalty = Math.max(0, strongExtras.length - 1) * EXTRA_WORD_PENALTY;

  const credit = status.reduce((sum, x) => sum + x.credit, 0);
  const score = tokens.length ? Math.max(0, credit - penalty) / tokens.length : 0;
  const saidSomething = heardTokens.some((t) => t !== UNCLEAR);
  const allExact = status.every((x) => x.s === 'ok');
  const clean = (w) => w.replace(/[.,!?;:]/g, '');

  return {
    passed: saidSomething && (passMark >= 1 ? allExact && penalty === 0 : score >= passMark - 1e-9),
    score,
    percent: Math.round(score * 100),
    wordStatus,
    wordHeard,
    wrongWords: words.filter((_, idx) => wordStatus[idx] === 'wrong' || wordStatus[idx] === 'missing').map(clean),
    closeWords: words.filter((_, idx) => wordStatus[idx] === 'close').map(clean),
    extraWords: strongExtras,
    heardTokens,
  };
}

/**
 * Live "karaoke" progress while the person is still speaking.
 * @returns {boolean[]} one flag per display word: true = already heard
 */
export function liveProgress(sentence, partialText) {
  const { words, tokens } = analyzeTarget(sentence);
  const heard = tokenizeHeard(partialText, tokens);
  if (!heard.length) return words.map(() => false);
  // Only the part of the sentence reached so far is compared, so later words stay unlit.
  const { status } = align(tokens, heard);
  let last = -1;
  status.forEach((st, k) => { if (st.s === 'ok' || st.s === 'close') last = k; });
  const lit = words.map(() => false);
  status.forEach((st, k) => {
    if (k <= last && (st.s === 'ok' || st.s === 'close')) lit[tokens[k].w] = true;
  });
  return lit;
}

/** How many stars a cleared sentence earns: fewer tries and a higher score = more stars. */
export function starsFor(percent, attempts) {
  if (attempts <= 1 && percent >= 95) return 3;
  if (attempts <= 2 && percent >= 80) return 2;
  return 1;
}

/** Lowercase text without punctuation, as expected by the Vosk grammar. */
export const toGrammarPhrase = (sentence) =>
  sentence
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

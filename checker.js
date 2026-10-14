// Pure JavaScript sentence checker (no native code), so it is easy to test and tweak.
//
// How it works:
//  1. The target sentence and the recognized speech are turned into lowercase word tokens.
//  2. Tokens are aligned with an edit-distance algorithm, so we know for EVERY target word whether it
//     was read correctly ('ok'), replaced by another word ('wrong') or skipped ('missing').
//  3. Words that sound identical (to / too / two, their / there ...) count as correct,
//     because the person pronounced them correctly even if the spelling differs.
import { HOMOPHONES } from './phonetics';

// Spoken two-word forms that count as one contraction in the target sentence.
// ("they are" is accepted for "they're", "could not" for "couldn't" ...)
const CONTRACTION_PAIRS = {
  'they are': 'theyre', 'could not': 'couldnt', 'can not': 'cant', 'will not': 'wont',
  'do not': 'dont', 'does not': 'doesnt', 'did not': 'didnt', 'is not': 'isnt',
  'are not': 'arent', 'was not': 'wasnt', 'were not': 'werent', 'would not': 'wouldnt',
  'should not': 'shouldnt', 'has not': 'hasnt', 'have not': 'havent', 'i am': 'im',
  'we are': 'were', 'you are': 'youre', 'i will': 'ill', 'i have': 'ive', 'i would': 'id',
  'let us': 'lets', 'there is': 'theres', 'what is': 'whats', 'that is': 'thats',
};

// Noise the recognizer likes to add. Ignored when they are EXTRA words (never required).
const FILLERS = new Set(['uh', 'um', 'umm', 'er', 'ah', 'hmm', 'mm', 'huh', 'eh']);
const WEAK_EXTRAS = new Set(['the', 'a', 'an', 'and', 'of']);

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
 * Recognized text -> tokens. Fillers and "[unk]" are removed, and two-word forms such as
 * "they are" are merged when the target sentence contains the matching contraction.
 */
export function tokenizeHeard(text, targetTokens = []) {
  const wanted = new Set(targetTokens.map((x) => x.t));
  const raw = (text || '')
    .replace(/\[unk\]/gi, ' ')
    .split(/\s+/)
    .map(toToken)
    .filter((t) => t && (!FILLERS.has(t) || wanted.has(t)));

  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const merged = CONTRACTION_PAIRS[`${raw[i]} ${raw[i + 1]}`];
    if (merged && wanted.has(merged)) {
      out.push(merged);
      i++;
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

const equalTokens = (t, h) =>
  t === h || Boolean(HOMO[t] && HOMO[t].has(h)) || Boolean(HOMO[h] && HOMO[h].has(t));

/**
 * Align the heard tokens with the target tokens (Levenshtein alignment).
 * Returns one entry per target token plus the extra words that were heard.
 */
export function align(targetTokens, heardTokens) {
  const n = targetTokens.length;
  const m = heardTokens.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i;
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = dp[i - 1][j - 1] + (equalTokens(targetTokens[i - 1].t, heardTokens[j - 1]) ? 0 : 1);
      dp[i][j] = Math.min(sub, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  const status = new Array(n);
  const extras = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = equalTokens(targetTokens[i - 1].t, heardTokens[j - 1]);
      if (dp[i][j] === dp[i - 1][j - 1] + (same ? 0 : 1)) {
        status[i - 1] = same ? { s: 'ok' } : { s: 'wrong', heard: heardTokens[j - 1] };
        i--; j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      status[i - 1] = { s: 'missing' };
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
 * @param {{minAccuracy?: number}} opts  1 = every word must be right (default)
 * @returns {{passed, accuracy, wordStatus, wrongWords, extraWords, heardTokens}}
 *   wordStatus has one entry per DISPLAY word: 'ok' | 'wrong' | 'missing'
 */
export function evaluate(sentence, heardText, { minAccuracy = 1 } = {}) {
  const { words, tokens } = analyzeTarget(sentence);
  const heardTokens = tokenizeHeard(heardText, tokens);
  const { status, extras } = align(tokens, heardTokens);

  const wordStatus = words.map(() => 'ok');
  tokens.forEach((tok, k) => {
    const s = status[k].s;
    if (s === 'wrong' || (s === 'missing' && wordStatus[tok.w] !== 'wrong')) wordStatus[tok.w] = s;
  });

  const okCount = status.filter((x) => x.s === 'ok').length;
  const accuracy = tokens.length ? okCount / tokens.length : 0;
  const strongExtras = extras.filter((e) => !WEAK_EXTRAS.has(e));
  const wrongWords = words.filter((_, idx) => wordStatus[idx] !== 'ok');

  return {
    passed: heardTokens.length > 0 && accuracy >= minAccuracy && strongExtras.length === 0,
    accuracy,
    wordStatus,
    wrongWords,
    extraWords: strongExtras,
    heardTokens,
  };
}

/** Turn the FIRST problem word into 'wrong' so the UI can show "you got stuck here". */
export function markStuckWord(wordStatus) {
  const out = [...wordStatus];
  const first = out.findIndex((s) => s !== 'ok');
  if (first >= 0) out[first] = 'wrong';
  return out;
}

/** Lowercase text without punctuation, as expected by the Vosk grammar. */
export const toGrammarPhrase = (sentence) =>
  sentence
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

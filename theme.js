// Colors and type for the whole app. Change a value here and every screen follows.
// The navy and teal come from the school logo.
export const C = {
  paper: '#F2F5F9',     // screen background
  card: '#FFFFFF',
  ink: '#12305A',       // navy: text and main buttons
  inkDeep: '#0A2040',
  teal: '#18A7B8',
  tealDeep: '#0E7F8D',
  tealSoft: '#DDF3F6',
  line: '#D9E2EC',
  muted: '#5B6E85',
  good: '#1C9A5E', goodSoft: '#E1F4EA',
  close: '#B26B00', closeSoft: '#FCEFD3',
  bad: '#D2433B', badSoft: '#FBE5E3',
  gold: '#F2B01E',
  margin: '#F0A6A0',    // the notebook margin line
  white: '#FFFFFF',
};

// Lexend was designed to make reading easier, which is what this app is about.
// These are swapped for system fonts if the font files cannot be loaded.
export const FONT = {
  regular: 'Lexend_400Regular',
  medium: 'Lexend_500Medium',
  semi: 'Lexend_600SemiBold',
  bold: 'Lexend_700Bold',
};

let fontsReady = false;
export const setFontsReady = (ok) => { fontsReady = ok; };

/** Text style for a weight: 'regular' | 'medium' | 'semi' | 'bold' */
export const font = (weight = 'regular') =>
  fontsReady
    ? { fontFamily: FONT[weight] }
    : { fontWeight: { regular: '400', medium: '500', semi: '600', bold: '700' }[weight] };

export const MARK_COLORS = {
  ok: { fg: C.good, bg: C.goodSoft },
  close: { fg: C.close, bg: C.closeSoft },
  wrong: { fg: C.bad, bg: C.badSoft },
  missing: { fg: C.bad, bg: C.badSoft },
};

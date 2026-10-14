import vocab from './vocab.json';

export const DIFFICULTIES = [
  { key: 'Beginner',     label: 'Beginner',     emoji: '🌱', color: '#22c55e', desc: 'Short and simple sentences' },
  { key: 'Intermediate', label: 'Intermediate', emoji: '🔥', color: '#f59e0b', desc: 'Longer sentences, trickier words' },
  { key: 'Advanced',     label: 'Advanced',     emoji: '🚀', color: '#a855f7', desc: 'Big vocabulary and tongue twisters' },
];

export const STAGE_NAMES = ['Warm-up', 'Challenge', 'Final Boss'];


const raw = {
  Beginner: ["The cat sat on the mat.", "She has a red apple.", "I like to run and jump.", "The sun is very hot today.", "He plays with his big dog.", "We eat rice and fish for dinner.", "My mother makes good soup.", "The bird flies in the blue sky.", "Look at the tall green tree.", "I read a book before bed.", "The baby is crying for milk.", "Put the pen on the desk.", "They went to the park by bus.", "Can you see the yellow star?", "He has two black shoes.", "We drink water when we are thirsty.", "The frog jumps into the pool.", "Please close the front door.", "I want to buy a new toy.", "She sings a sweet song.", "The man is driving a truck.", "Do you want some hot tea?", "The wind blows the leaves away.", "My hands are cold in winter.", "The clock strikes twelve at noon.", "I found a shell on the beach.", "He is fixing his broken bike.", "She has a beautiful smile.", "The duck swims in the lake.", "We walk to school every day.", "The dog chased the small cat.", "I can hear the loud music.", "Please pass the salt and pepper.", "The train is coming to the station."],
  Intermediate: ["She carefully wrapped the fragile present.", "They’re going to put their bags over there.", "If I had known, I would have gone to the bakery.", "The fierce wind howled through the dark alley.", "He realized his mistake immediately.", "The museum exhibited ancient artifacts.", "Would you prefer coffee or herbal tea?", "She thoroughly enjoyed the theater performance.", "The mountain path was dangerously steep.", "He couldn’t decide which dessert to order.", "The submarine explored the depths of the ocean.", "I usually walk to work, but today I drove.", "The lawyer presented a compelling argument.", "She wore a comfortable, thick sweater.", "The robot performed complex calculations instantly.", "We watched the breathtaking sunset from the balcony.", "The doctor measured the patient's blood pressure.", "He is responsible for organizing the conference.", "The legendary sword was hidden in the cave.", "She wrote a detailed report on the economy.", "The exotic bird had brightly colored feathers.", "They are building a massive bridge across the river.", "The comedian told a hilarious joke.", "He accidentally dropped his phone into the puddle.", "The scientist discovered a new species of plant.", "She speaks three languages fluently.", "The orchestra played a beautiful symphony.", "He was exhausted after the grueling marathon.", "The fragile glass shattered into a thousand pieces.", "We need to schedule a meeting for tomorrow.", "The politician made a controversial statement.", "She was thrilled to receive the prestigious award.", "The heavy rain caused severe flooding."],
  Advanced: ["The aforementioned regulations supersede all prior legislation.", "She thoroughly thought through the theoretical thesis.", "Peter Piper picked a peck of pickled peppers.", "The charismatic entrepreneur established several successful startups.", "Isomorphic structures exhibit identical geometrical properties.", "The philosophical discourse explored existential themes.", "His belligerent demeanor alienated his prospective colleagues.", "The ethereal mist enveloped the desolate landscape.", "She eloquently articulated her nuanced perspective.", "The idiosyncratic scientist challenged conventional paradigms.", "A plethora of bureaucratic obstacles hindered progress.", "The clandestine operation was successfully executed.", "He possessed an insatiable thirst for knowledge.", "The ubiquitous nature of the internet is undeniable.", "Her ostentatious display of wealth was distasteful.", "The menacing locomotive hurtled down the track.", "They perused the ancient manuscript with great scrutiny.", "The convoluted plot confused the bewildered audience.", "A multifaceted approach is required to solve this.", "The juxtaposition of light and shadow created depth.", "He was known for his meticulous attention to detail.", "The archaic language made the text difficult to decipher.", "She demonstrated unparalleled proficiency in astrophysics.", "The ambivalent protagonist struggled with his morality.", "An unexpected anomaly disrupted the chronological sequence.", "The cacophony of the city was overwhelming.", "He extrapolated the data to reach a logical conclusion.", "The ubiquitous phenomenon continues to fascinate researchers.", "A ubiquitous, albeit ephemeral, sense of joy permeated the room.", "The rigorous curriculum prepared students for university.", "She gave a comprehensive analysis of the geopolitical situation.", "The diaphanous curtains fluttered in the gentle breeze.", "In retrospect, the strategic maneuver was a catastrophic failure."],
};

// Words the offline speech model cannot recognize (filled in automatically by the GitHub build).
// Sentences containing them are skipped, so every sentence you get can really be heard.
const OOV = new Set(vocab.oov || []);
const wordsOf = (sentence) =>
  sentence.toLowerCase().replace(/[’‘`]/g, '\'').replace(/[^a-z\' ]+/g, ' ').split(/\s+/).filter(Boolean);
const playable = (list) => {
  const ok = list.filter((sentence) => !wordsOf(sentence).some((w) => OOV.has(w)));
  return ok.length >= 6 ? ok : list;
};

// Sort by length and split into 3 tiers: Level 1 = shortest, Level 3 = longest.
const toStages = (list) => {
  const sorted = [...playable(list)].sort(
    (a, b) => a.split(' ').length - b.split(' ').length || a.length - b.length
  );
  const n = Math.ceil(sorted.length / 3);
  return [sorted.slice(0, n), sorted.slice(n, 2 * n), sorted.slice(2 * n)];
};

export const stages = {
  Beginner: toStages(raw.Beginner),
  Intermediate: toStages(raw.Intermediate),
  Advanced: toStages(raw.Advanced),
};

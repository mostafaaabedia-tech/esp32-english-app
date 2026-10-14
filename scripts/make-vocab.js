// Runs in GitHub Actions after the speech model is downloaded.
// Finds sentence words that are NOT in the speech model's vocabulary (the recognizer could never
// "hear" them) and writes them to vocab.json. sentences.js then skips those sentences.
const fs = require('fs');
const path = require('path');

const modelDir = process.argv[2] || 'assets/model-en-us';
const file = ['graph/words.txt', 'words.txt'].map((p) => path.join(modelDir, p)).find((f) => fs.existsSync(f));

if (!file) {
  console.log('[vocab] No words.txt in the model - skipping the vocabulary check (all sentences stay enabled).');
  process.exit(0);
}

const vocab = new Set(
  fs.readFileSync(file, 'utf8').split('\n').map((l) => l.split(/\s+/)[0].toLowerCase()).filter(Boolean)
);
if (vocab.size < 1000) {
  console.log(`[vocab] ${file} only has ${vocab.size} entries - skipping the vocabulary check.`);
  process.exit(0);
}

const src = fs.readFileSync('sentences.js', 'utf8');
const sentences = [...src.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const oov = new Set();
for (const s of sentences) {
  for (const w of s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean)) {
    if (!vocab.has(w)) oov.add(w);
  }
}
fs.writeFileSync('vocab.json', JSON.stringify({ oov: [...oov].sort() }, null, 2) + '\n');
const blocked = sentences.filter((s) =>
  s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z' ]+/g, ' ').split(/\s+/).some((w) => oov.has(w))
);
console.log(`[vocab] ${vocab.size} words in model. Words not in model: ${[...oov].join(', ') || 'none'}`);
console.log(`[vocab] ${blocked.length} of ${sentences.length} sentences will be skipped.`);

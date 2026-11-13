# Speak It Right

Read English sentences out loud. The app listens offline, marks every word, and lights the ESP32 LEDs.
Made by Mostafa Mesbah Abedi and Soliman Lodin.

## What it does
- Three levels of English (Beginner, Intermediate, Advanced), 5 levels each, up to 3 stars per level
- Offline listening (Vosk model packed into the APK) with live word highlighting while you read
- Every word is marked: right (green), almost (amber), missed (red), with what was heard instead
- Two ways of listening (Guided / Open) and three pass marks (Relaxed 70%, Normal 85%, Perfect)
- Phonetics (IPA) under each word; tap a word to hear it slowly
- Tricky words: missed words are saved and can be practised one at a time
- Points, a daily goal of 5 sentences, and a day streak, saved on the phone
- Always left-to-right, also when the phone language is Persian
- ESP32 LEDs: green = correct, red = wrong, alternating blink = you win

## Get the APK from GitHub
1. Put all files at the top level of the repo, on the `main` branch.
2. Open **Actions -> Build Android APK** (runs on every push, or press **Run workflow**).
3. After about 20-30 minutes download **speak-it-right-apk** from *Artifacts*.

## Files
| File | What it is |
|---|---|
| `App.js` | screens and app logic (timings such as PAUSE_AFTER_SPEECH_MS are at the top) |
| `ui.js` | buttons, stars, bars, animations |
| `theme.js` | colors and fonts |
| `checker.js` | how readings are scored (credit for "almost" words is at the top) |
| `storage.js` | saved progress, daily goal, tricky-word rules |
| `sentences.js` | sentences, level names, level colors |
| `phonetics.js` | IPA and same-sounding words (regenerate with `scripts/generate-phonetics.mjs` after adding words) |
| `vocab.json` | words the speech model does not know; sentences using them are skipped |
| `plugins/withForceLTR.js` | locks the app to left-to-right |
| `plugins/withSplashColor.js` | fixes a build error in the splash screen |
| `esp32/speak_it_right/speak_it_right.ino` | upload to the ESP32 (commands: c, w, r, v) |

Native Bluetooth and speech modules do not work in Expo Go. Use the built APK.

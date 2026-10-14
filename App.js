import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, Animated, Easing, Vibration,
  PermissionsAndroid, Platform, ActivityIndicator, Dimensions, ScrollView, BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import * as Vosk from 'react-native-vosk';
import { BleManager, State } from 'react-native-ble-plx';
import { DIFFICULTIES, STAGE_NAMES, stages } from './sentences';
import { IPA } from './phonetics';
import { evaluate, tokenizeHeard, markStuckWord, toGrammarPhrase } from './checker';

// ───────────────────────── Constants ─────────────────────────
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea0730544b34';
const SCAN_TIMEOUT_MS = 10000;

// Base64 of the single characters 'c', 'w', 'r', 'v' (ble-plx needs base64 payloads).
const COMMANDS = { correct: 'Yw==', wrong: 'dw==', reset: 'cg==', win: 'dg==' };

// Offline speech engine (Vosk). The model folder is added to the APK by the GitHub build.
const MODEL_NAME = 'model-en-us';
const LISTEN_TIMEOUT_MS = 12000;
const DETAILED_MIN_ACCURACY = 0.85; // "Detailed" mode: share of words that must be right

const C = {
  bg: '#0f172a', card: '#1e293b', border: '#334155', text: '#f8fafc',
  muted: '#94a3b8', good: '#22c55e', bad: '#ef4444', blue: '#3b82f6', warn: '#f59e0b',
};

// ───────────────────────── Helpers ─────────────────────────
const cleanWord = (w) => w.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z']/g, '');

const pickFrom = (list, avoid) => {
  let next = avoid;
  while (next === avoid && list.length > 1) {
    next = list[Math.floor(Math.random() * list.length)];
  }
  return next === avoid ? list[0] : next;
};

async function requestBlePermissions() {
  if (Platform.OS !== 'android') return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const granted = PermissionsAndroid.RESULTS.GRANTED;
  if (Platform.Version >= 31) {
    const res = await PermissionsAndroid.requestMultiple([P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT]);
    return Object.values(res).every((r) => r === granted);
  }
  return (await PermissionsAndroid.request(P.ACCESS_FINE_LOCATION)) === granted;
}

async function requestMicPermission() {
  if (Platform.OS !== 'android') return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

const BLE_LABELS = {
  disconnected: '📡  Connect to ESP32',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: '✅  ESP32 connected',
};

const MODES = {
  guided: { label: 'Guided', desc: 'Most reliable. Every word must be right, and it shows where you got stuck.' },
  detailed: { label: 'Detailed', desc: 'Checks each word one by one (85% needed). Needs very clear speech.' },
};

// ───────────────────────── Confetti ─────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CONFETTI = ['🎉', '⭐', '✨', '🎊', '🌟'];

function Confetti({ count = 26 }) {
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => ({
      x: Math.random() * (SCREEN_W - 30),
      delay: Math.random() * 1500,
      duration: 2800 + Math.random() * 2200,
      emoji: CONFETTI[i % CONFETTI.length],
      size: 18 + Math.random() * 16,
      anim: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const loops = pieces.map((p) =>
      Animated.loop(
        Animated.timing(p.anim, {
          toValue: 1, duration: p.duration, delay: p.delay,
          easing: Easing.linear, useNativeDriver: true,
        })
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [pieces]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute', left: p.x, top: -40, fontSize: p.size,
            opacity: p.anim.interpolate({ inputRange: [0, 0.9, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_H + 60] }) },
              { rotate: p.anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
            ],
          }}
        >
          {p.emoji}
        </Animated.Text>
      ))}
    </View>
  );
}

// ───────────────────────── Home screen ─────────────────────────
function HomeScreen({ bleState, onBle, engine, engineError, onRetryEngine, mode, onMode, onStart, completed }) {
  const busy = bleState === 'scanning' || bleState === 'connecting';
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.logo}>🗣️</Text>
      <Text style={styles.title}>Speak It Right</Text>
      <Text style={styles.subtitle}>Read each sentence out loud. Pass 3 levels to win!</Text>

      <TouchableOpacity
        style={[
          styles.pill,
          engine === 'ready' && { backgroundColor: '#14532d', borderColor: C.good },
          engine === 'error' && { backgroundColor: '#7f1d1d', borderColor: C.bad },
        ]}
        onPress={engine === 'error' ? onRetryEngine : undefined}
        activeOpacity={engine === 'error' ? 0.8 : 1}
      >
        {engine === 'loading' && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
        <Text style={styles.pillText}>
          {engine === 'loading' && 'Loading offline speech engine… (first start takes a bit)'}
          {engine === 'ready' && '✅  Offline speech ready – no internet needed'}
          {engine === 'error' && '⚠️  Speech engine failed – tap to retry'}
        </Text>
      </TouchableOpacity>
      {engine === 'error' && !!engineError && <Text style={styles.engineError}>{engineError}</Text>}

      <TouchableOpacity
        style={[styles.pill, { marginTop: 10 }, bleState === 'connected' && { backgroundColor: '#14532d', borderColor: C.good }]}
        onPress={onBle}
        disabled={busy}
        activeOpacity={0.8}
      >
        {busy && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
        <Text style={styles.pillText}>{BLE_LABELS[bleState]}</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionLabel, { marginTop: 26 }]}>CHECKER</Text>
      <View style={styles.modeRow}>
        {Object.keys(MODES).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.modeBtn, mode === k && styles.modeBtnActive]}
            onPress={() => onMode(k)}
          >
            <Text style={[styles.modeText, mode === k && { color: '#fff' }]}>{MODES[k].label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.modeDesc}>{MODES[mode].desc}</Text>

      <Text style={[styles.sectionLabel, { marginTop: 22 }]}>CHOOSE YOUR DIFFICULTY</Text>
      {DIFFICULTIES.map((d) => (
        <TouchableOpacity
          key={d.key}
          style={[styles.diffCard, { borderLeftColor: d.color }]}
          onPress={() => onStart(d.key)}
          activeOpacity={0.85}
        >
          <Text style={styles.diffEmoji}>{d.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.diffName}>{d.label}</Text>
            <Text style={styles.diffDesc}>{d.desc}</Text>
            <Text style={[styles.diffLevels, { color: d.color }]}>3 levels</Text>
          </View>
          <Text style={styles.diffArrow}>{completed[d.key] ? '🏆' : '›'}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ───────────────────────── Progress steps ─────────────────────────
function ProgressSteps({ done, current, color }) {
  return (
    <View style={styles.steps}>
      {[0, 1, 2].map((i) => (
        <React.Fragment key={i}>
          <View
            style={[
              styles.stepDot,
              i < done && { backgroundColor: color, borderColor: color },
              i === current && i >= done && { borderColor: color },
            ]}
          >
            <Text style={styles.stepText}>{i < done ? '✓' : i + 1}</Text>
          </View>
          {i < 2 && <View style={[styles.stepLine, i < done && { backgroundColor: color }]} />}
        </React.Fragment>
      ))}
    </View>
  );
}

// ───────────────────────── Sentence with phonetics ─────────────────────────
function WordsView({ sentence, wordStatus, showPhonetics, onWordPress }) {
  const words = sentence.split(/\s+/).filter(Boolean);
  return (
    <View style={styles.wordsWrap}>
      {words.map((w, i) => {
        const ipa = IPA[cleanWord(w)];
        const st = wordStatus ? wordStatus[i] : null;
        const color = st === 'ok' ? C.good : st === 'wrong' ? C.bad : st === 'missing' ? C.warn : C.text;
        return (
          <TouchableOpacity key={i} style={styles.wordChip} onPress={() => onWordPress(cleanWord(w))} activeOpacity={0.6}>
            <Text style={[styles.wordText, { color }]}>{w}</Text>
            {showPhonetics && !!ipa && (
              <Text style={[styles.ipaText, st ? { color } : null]}>/{ipa}/</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ───────────────────────── Game screen ─────────────────────────
function GameScreen({
  diff, stageIndex, sentence, wordStatus, result, listening, heard, engineReady,
  showPhonetics, onTogglePhonetics,
  onMic, onHear, onHearWord, onSwap, onNext, onBack,
}) {
  const pop = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const isCorrect = result.kind === 'correct';
  const lastStage = stageIndex === 2;

  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, useNativeDriver: true }).start();
  }, [sentence, pop]);

  useEffect(() => {
    if (result.kind !== 'wrong') return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -12, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [result.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!listening) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => { loop.stop(); pulse.setValue(1); };
  }, [listening, pulse]);

  const resultColor =
    { correct: C.good, wrong: C.bad, error: C.bad, listening: C.blue }[result.kind] ?? C.muted;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Menu</Text>
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: diff.color }]}>{diff.emoji} {diff.label}</Text>
        <View style={{ width: 70 }} />
      </View>

      <ProgressSteps done={stageIndex + (isCorrect ? 1 : 0)} current={stageIndex} color={diff.color} />
      <Text style={styles.levelLabel}>
        LEVEL {stageIndex + 1} OF 3 · {STAGE_NAMES[stageIndex].toUpperCase()}
      </Text>

      <Animated.View
        style={[
          styles.sentenceCard,
          { borderColor: isCorrect ? C.good : result.kind === 'wrong' ? C.bad : C.border },
          { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }, { translateX: shake }] },
        ]}
      >
        <WordsView
          sentence={sentence}
          wordStatus={wordStatus}
          showPhonetics={showPhonetics}
          onWordPress={onHearWord}
        />
      </Animated.View>
      <Text style={styles.tapHint}>Tap any word to hear it</Text>

      <View style={styles.helperRow}>
        <TouchableOpacity style={styles.helperBtn} onPress={onHear} disabled={listening}>
          <Text style={styles.helperText}>🔊 Hear it</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.helperBtn} onPress={onTogglePhonetics}>
          <Text style={styles.helperText}>{showPhonetics ? '🔤 Phonetics: ON' : '🔤 Phonetics: OFF'}</Text>
        </TouchableOpacity>
        {!isCorrect && (
          <TouchableOpacity style={styles.helperBtn} onPress={onSwap} disabled={listening}>
            <Text style={styles.helperText}>🔀 Another</Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.View style={{ transform: [{ scale: pulse }], marginVertical: 18 }}>
        <TouchableOpacity
          style={[
            styles.micButton,
            { backgroundColor: listening ? C.bad : diff.color },
            !engineReady && { opacity: 0.4 },
          ]}
          onPress={onMic}
          disabled={isCorrect || !engineReady}
          activeOpacity={0.85}
        >
          <Text style={styles.micIcon}>{listening ? '⏹' : '🎙️'}</Text>
        </TouchableOpacity>
      </Animated.View>
      <Text style={styles.micHint}>
        {!engineReady
          ? 'Speech engine is loading…'
          : listening
          ? 'Listening… read the sentence (tap to stop)'
          : isCorrect
          ? 'Nice!'
          : 'Tap the mic and read the sentence'}
      </Text>
      {listening && (
        <Text style={styles.heardText}>{heard ? `“${heard}”` : 'Waiting for your voice…'}</Text>
      )}

      <View style={[styles.resultBox, { borderColor: resultColor }]}>
        <Text style={[styles.resultText, { color: resultColor }]}>{result.text}</Text>
      </View>

      {isCorrect && !lastStage && (
        <TouchableOpacity style={[styles.nextBtn, { backgroundColor: diff.color }]} onPress={onNext}>
          <Text style={styles.nextText}>Next level ➜</Text>
        </TouchableOpacity>
      )}
      {isCorrect && lastStage && <Text style={styles.winSoon}>🏆 All 3 levels done…</Text>}
    </ScrollView>
  );
}

// ───────────────────────── Win screen ─────────────────────────
function WinScreen({ diff, mistakes, nextDiff, onAgain, onNextDiff, onHome }) {
  const stars = mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1;
  const starAnims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(
      250,
      starAnims.map((a) => Animated.spring(a, { toValue: 1, friction: 4, useNativeDriver: true }))
    ).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -14, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [starAnims, bounce]);

  return (
    <View style={{ flex: 1 }}>
      <Confetti />
      <ScrollView contentContainerStyle={[styles.screen, { justifyContent: 'center', flexGrow: 1 }]}>
        <Animated.Text style={[styles.trophy, { transform: [{ translateY: bounce }] }]}>🏆</Animated.Text>
        <Text style={[styles.winTitle, { color: diff.color }]}>YOU WIN!</Text>
        <Text style={styles.winSub}>You finished all 3 {diff.label} levels</Text>

        <View style={styles.starsRow}>
          {starAnims.map((a, i) => (
            <Animated.Text key={i} style={[styles.star, { transform: [{ scale: a }], opacity: a }]}>
              {i < stars ? '⭐' : '☆'}
            </Animated.Text>
          ))}
        </View>
        <Text style={styles.winStats}>
          {mistakes === 0 ? 'Perfect run – no mistakes!' : `${mistakes} mistake${mistakes === 1 ? '' : 's'} along the way`}
        </Text>

        <TouchableOpacity style={[styles.nextBtn, { backgroundColor: diff.color, width: '100%' }]} onPress={onAgain}>
          <Text style={styles.nextText}>🔁 Play again</Text>
        </TouchableOpacity>
        {nextDiff && (
          <TouchableOpacity style={[styles.nextBtn, { backgroundColor: nextDiff.color, width: '100%' }]} onPress={onNextDiff}>
            <Text style={styles.nextText}>{nextDiff.emoji} Try {nextDiff.label}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.nextBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, width: '100%' }]} onPress={onHome}>
          <Text style={styles.nextText}>🏠 Menu</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ───────────────────────── App ─────────────────────────
export default function App() {
  const [screen, setScreen] = useState('home'); // 'home' | 'game' | 'win'
  const [diffKey, setDiffKey] = useState('Beginner');
  const [stageIndex, setStageIndex] = useState(0);
  const [sentence, setSentence] = useState('');
  const [wordStatus, setWordStatus] = useState(null); // per-word 'ok' | 'wrong' | 'missing'
  const [result, setResult] = useState({ kind: 'idle', text: 'Ready when you are!', id: 0 });
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [mistakes, setMistakes] = useState(0);
  const [bleState, setBleState] = useState('disconnected');
  const [completed, setCompleted] = useState({});
  const [engine, setEngine] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [engineError, setEngineError] = useState('');
  const [mode, setMode] = useState('guided'); // 'guided' | 'detailed'
  const [showPhonetics, setShowPhonetics] = useState(true);

  const managerRef = useRef(null);
  if (!managerRef.current) managerRef.current = new BleManager();
  const deviceRef = useRef(null);
  const sentenceRef = useRef('');
  sentenceRef.current = sentence;
  const handlersRef = useRef({});
  const timerRef = useRef(null);
  const resultId = useRef(0);
  const sessionRef = useRef({ active: false, done: true });

  const makeResult = (kind, text) => ({ kind, text, id: ++resultId.current });
  const diff = DIFFICULTIES.find((d) => d.key === diffKey);

  // ── BLE ──
  const sendCommand = useCallback(async (cmd) => {
    const device = deviceRef.current;
    if (!device) return false;
    try {
      await device.writeCharacteristicWithResponseForService(SERVICE_UUID, CHAR_UUID, COMMANDS[cmd]);
      return true;
    } catch (e) {
      console.warn('BLE write failed', e);
      return false;
    }
  }, []);

  const connectBluetooth = async () => {
    const manager = managerRef.current;
    if (bleState === 'connected') {
      await deviceRef.current?.cancelConnection().catch(() => {});
      return;
    }
    if (bleState !== 'disconnected') return;

    if (!(await requestBlePermissions())) {
      Alert.alert('Permission needed', 'Bluetooth permission is required to find the ESP32.');
      return;
    }
    if ((await manager.state()) !== State.PoweredOn) {
      try {
        await manager.enable();
      } catch {
        Alert.alert('Bluetooth is off', 'Turn on Bluetooth and try again.');
        return;
      }
    }

    setBleState('scanning');
    let found = false;
    const timeout = setTimeout(() => {
      manager.stopDeviceScan();
      if (!found) {
        setBleState('disconnected');
        Alert.alert('Not found', 'Could not find "SpeakItRight". Is the ESP32 powered on?');
      }
    }, SCAN_TIMEOUT_MS);

    manager.startDeviceScan([SERVICE_UUID], null, async (error, device) => {
      if (error) {
        clearTimeout(timeout);
        setBleState('disconnected');
        Alert.alert('Scan error', error.message);
        return;
      }
      if (!device || found) return;
      found = true;
      clearTimeout(timeout);
      manager.stopDeviceScan();
      try {
        setBleState('connecting');
        const connected = await device.connect({ timeout: 10000 });
        await connected.discoverAllServicesAndCharacteristics();
        deviceRef.current = connected;
        connected.onDisconnected(() => {
          deviceRef.current = null;
          setBleState('disconnected');
        });
        setBleState('connected');
      } catch (e) {
        setBleState('disconnected');
        Alert.alert('Connection failed', e.message);
      }
    });
  };

  // ── Offline speech engine ──
  const loadEngine = useCallback(() => {
    setEngine('loading');
    setEngineError('');
    Vosk.loadModel(MODEL_NAME)
      .then(() => setEngine('ready'))
      .catch((e) => {
        setEngine('error');
        setEngineError(String(e?.message ?? e));
      });
  }, []);

  useEffect(() => {
    loadEngine();
    const subs = [
      Vosk.onPartialResult((t) => handlersRef.current.partial?.(t)),
      Vosk.onResult((t) => handlersRef.current.result?.(t)),
      Vosk.onFinalResult((t) => handlersRef.current.final?.(t)),
      Vosk.onError((e) => handlersRef.current.error?.(e)),
      Vosk.onTimeout(() => handlersRef.current.timeout?.()),
    ];
    const manager = managerRef.current;
    return () => {
      subs.forEach((s) => s?.remove?.());
      clearTimeout(timerRef.current);
      clearTimeout(sessionRef.current.silenceTimer);
      clearTimeout(sessionRef.current.stopTimer);
      Speech.stop();
      try { Vosk.unload(); } catch {}
      deviceRef.current?.cancelConnection().catch(() => {});
      manager.destroy();
    };
  }, [loadEngine]);

  // ── What happens when a reading is judged correct ──
  const onSuccess = (note) => {
    setResult(makeResult('correct', stageIndex === 2 ? '🎉 PERFECT! Final level cleared!' : `✅ Correct! Well done.${note || ''}`));
    Vibration.vibrate(80);
    sendCommand('correct');
    if (stageIndex === 2) {
      timerRef.current = setTimeout(() => {
        setCompleted((prev) => ({ ...prev, [diffKey]: true }));
        setScreen('win');
        sendCommand('win');
      }, 1400);
    }
  };

  // ── Judge what the recognizer heard (re-created each render so it never goes stale) ──
  const judge = (s) => {
    const target = sentenceRef.current;
    const guided = s.mode === 'guided';
    const heardText = s.segments.join(' ').trim();
    const heardTokens = tokenizeHeard(heardText);
    const partialTokens = tokenizeHeard(s.bestPartial);

    if (!heardTokens.length && !partialTokens.length) {
      setWordStatus(null);
      setResult(makeResult('error', "🤔 I didn't hear a clear sentence.\nMove closer to the phone and try again."));
      return;
    }

    const res = evaluate(target, heardText, { minAccuracy: guided ? 1 : DETAILED_MIN_ACCURACY });
    if (res.passed) {
      setWordStatus(res.wordStatus);
      onSuccess(res.wrongWords.length ? `\n(Close enough: ${res.wrongWords.join(', ')})` : '');
      return;
    }

    // Not correct → show exactly which words went wrong
    const words = target.split(/\s+/).filter(Boolean);
    setMistakes((m) => m + 1);
    Vibration.vibrate([0, 60, 60, 60]);
    sendCommand('wrong');

    if (guided) {
      // The guided recognizer only follows the target sentence, so the words it got to
      // show how far the person came; the next word is where they got stuck.
      const basis = heardTokens.length ? heardText : s.bestPartial;
      const statuses = markStuckWord(evaluate(target, basis).wordStatus);
      setWordStatus(statuses);
      const idx = statuses.findIndex((x) => x !== 'ok');
      setResult(
        makeResult(
          'wrong',
          idx >= 0
            ? `❌ Not quite – I lost you at “${words[idx].replace(/[.,!?]/g, '')}”.\nTap the word to hear it, then try again.`
            : '❌ Not quite. Listen again and try once more.'
        )
      );
    } else {
      setWordStatus(res.wordStatus);
      const total = res.wordStatus.length;
      const okCount = res.wordStatus.filter((x) => x === 'ok').length;
      let text = `❌ ${okCount} of ${total} words correct (${Math.round(res.accuracy * 100)}%)`;
      if (res.wrongWords.length) text += `\nCheck: ${res.wrongWords.join(', ').replace(/[.,!?]/g, '')}`;
      if (res.extraWords.length) text += `\nExtra words: ${res.extraWords.join(' ')}`;
      text += `\nI heard: “${res.heardTokens.join(' ')}”`;
      setResult(makeResult('wrong', text));
    }
  };

  const finishSession = () => {
    const s = sessionRef.current;
    if (s.done) return;
    s.done = true;
    s.active = false;
    clearTimeout(s.silenceTimer);
    clearTimeout(s.stopTimer);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
    judge(s);
  };

  const failSession = (message) => {
    const s = sessionRef.current;
    s.done = true;
    s.active = false;
    clearTimeout(s.silenceTimer);
    clearTimeout(s.stopTimer);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
    setResult(makeResult('error', message));
  };

  handlersRef.current = {
    partial: (text) => {
      const s = sessionRef.current;
      if (!s.active) return;
      setHeard(text);
      if (tokenizeHeard(text).length >= tokenizeHeard(s.bestPartial).length) s.bestPartial = text;
      clearTimeout(s.silenceTimer); // still talking
    },
    result: (text) => {
      const s = sessionRef.current;
      if (!s.active) return;
      if (s.mode === 'guided') {
        // Ignore a lone noise blip right after pressing the mic
        const nothingYet = !tokenizeHeard(text).length && !s.bestPartial;
        if (nothingYet && Date.now() - s.startedAt < 1500) return;
        s.segments.push(text);
        finishSession();
        return;
      }
      // Detailed: collect pieces until the sentence is complete or the person goes quiet
      s.segments.push(text);
      clearTimeout(s.silenceTimer);
      const total = tokenizeHeard(s.segments.join(' ')).length;
      s.silenceTimer = setTimeout(finishSession, total >= s.targetCount ? 300 : 2200);
    },
    final: (text) => {
      const s = sessionRef.current;
      if (s.done || !s.stopping) return;
      if (text) s.segments.push(text);
      finishSession();
    },
    timeout: () => finishSession(),
    error: (e) => {
      console.warn('Vosk error', e);
      if (sessionRef.current.done) return;
      failSession('Speech engine error. Please try again.');
    },
  };

  // ── Microphone button ──
  const toggleListening = async () => {
    const s = sessionRef.current;

    // Tap while listening = stop and check what was heard
    if (s.active) {
      s.stopping = true;
      setResult(makeResult('idle', 'Checking what you said…'));
      try { Vosk.stop(); } catch {}
      s.stopTimer = setTimeout(finishSession, 700); // wait briefly for the final result
      return;
    }

    if (engine !== 'ready') {
      setResult(makeResult('error', 'The speech engine is not ready yet.'));
      return;
    }
    if (!(await requestMicPermission())) {
      Alert.alert('Microphone needed', 'Please allow microphone access to read aloud.');
      return;
    }

    Speech.stop();
    const target = sentenceRef.current;
    sessionRef.current = {
      active: true, done: false, stopping: false, mode,
      segments: [], bestPartial: '', startedAt: Date.now(),
      targetCount: target.split(/\s+/).filter(Boolean).length,
      silenceTimer: null, stopTimer: null,
    };
    setWordStatus(null);
    setHeard('');
    setListening(true);
    setResult(makeResult('listening', '🎙️ Listening… read the sentence'));

    try {
      const options = { timeout: LISTEN_TIMEOUT_MS };
      // Guided: the recognizer only listens for THIS sentence (much more accurate)
      if (mode === 'guided') options.grammar = [toGrammarPhrase(target), '[unk]'];
      await Vosk.start(options);
    } catch (e) {
      console.warn('Vosk.start failed', e);
      failSession('Could not start the microphone. Please try again.');
    }
  };

  // ── Game flow ──
  const stopAudio = () => {
    Speech.stop();
    const s = sessionRef.current;
    s.active = false;
    s.done = true;
    clearTimeout(s.silenceTimer);
    clearTimeout(s.stopTimer);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
  };

  const startGame = (key) => {
    clearTimeout(timerRef.current);
    stopAudio();
    setDiffKey(key);
    setStageIndex(0);
    setMistakes(0);
    setWordStatus(null);
    setSentence(pickFrom(stages[key][0], ''));
    setResult(makeResult('idle', 'Ready when you are!'));
    setScreen('game');
    sendCommand('reset');
  };

  const nextStage = () => {
    const idx = stageIndex + 1;
    stopAudio();
    setStageIndex(idx);
    setWordStatus(null);
    setSentence(pickFrom(stages[diffKey][idx], ''));
    setResult(makeResult('idle', 'Ready when you are!'));
    sendCommand('reset');
  };

  const swapSentence = () => {
    stopAudio();
    setWordStatus(null);
    setSentence((s) => pickFrom(stages[diffKey][stageIndex], s));
    setResult(makeResult('idle', 'New sentence – you got this!'));
    sendCommand('reset');
  };

  const goHome = useCallback(() => {
    clearTimeout(timerRef.current);
    Speech.stop();
    const s = sessionRef.current;
    s.active = false;
    s.done = true;
    clearTimeout(s.silenceTimer);
    clearTimeout(s.stopTimer);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
    setScreen('home');
    sendCommand('reset');
  }, [sendCommand]);

  const hearSentence = () => {
    Speech.stop();
    Speech.speak(sentence, { language: 'en-US', rate: 0.85 });
  };

  const hearWord = (word) => {
    if (!word) return;
    Speech.stop();
    Speech.speak(word, { language: 'en-US', rate: 0.75 });
  };

  // Android back button goes to the menu instead of closing the app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen !== 'home') {
        goHome();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, goHome]);

  const diffIndex = DIFFICULTIES.findIndex((d) => d.key === diffKey);
  const nextDiff = DIFFICULTIES[diffIndex + 1] ?? null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {screen === 'home' && (
        <HomeScreen
          bleState={bleState}
          onBle={connectBluetooth}
          engine={engine}
          engineError={engineError}
          onRetryEngine={loadEngine}
          mode={mode}
          onMode={setMode}
          onStart={startGame}
          completed={completed}
        />
      )}
      {screen === 'game' && (
        <GameScreen
          diff={diff}
          stageIndex={stageIndex}
          sentence={sentence}
          wordStatus={wordStatus}
          result={result}
          listening={listening}
          heard={heard}
          engineReady={engine === 'ready'}
          showPhonetics={showPhonetics}
          onTogglePhonetics={() => setShowPhonetics((v) => !v)}
          onMic={toggleListening}
          onHear={hearSentence}
          onHearWord={hearWord}
          onSwap={swapSentence}
          onNext={nextStage}
          onBack={goHome}
        />
      )}
      {screen === 'win' && (
        <WinScreen
          diff={diff}
          mistakes={mistakes}
          nextDiff={nextDiff}
          onAgain={() => startGame(diffKey)}
          onNextDiff={() => startGame(nextDiff.key)}
          onHome={goHome}
        />
      )}
    </View>
  );
}

// ───────────────────────── Styles ─────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  screen: { padding: 20, paddingTop: 56, paddingBottom: 56, alignItems: 'center' },

  // Home
  logo: { fontSize: 56 },
  title: { fontSize: 32, fontWeight: '800', color: C.text, marginTop: 4 },
  subtitle: { fontSize: 15, color: C.muted, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 30, paddingVertical: 12, paddingHorizontal: 22, width: '100%' },
  pillText: { color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  engineError: { color: C.bad, fontSize: 12, textAlign: 'center', marginTop: 6 },
  sectionLabel: { alignSelf: 'flex-start', color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  modeRow: { flexDirection: 'row', width: '100%' },
  modeBtn: { flex: 1, marginHorizontal: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  modeBtnActive: { backgroundColor: C.blue, borderColor: C.blue },
  modeText: { color: C.muted, fontWeight: '700', fontSize: 14 },
  modeDesc: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 8 },
  diffCard: { flexDirection: 'row', alignItems: 'center', width: '100%', backgroundColor: C.card, borderRadius: 16, borderLeftWidth: 6, padding: 18, marginBottom: 14, elevation: 3 },
  diffEmoji: { fontSize: 34, marginRight: 14 },
  diffName: { color: C.text, fontSize: 20, fontWeight: '700' },
  diffDesc: { color: C.muted, fontSize: 13, marginTop: 2 },
  diffLevels: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  diffArrow: { color: C.muted, fontSize: 28, marginLeft: 8 },

  // Game
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 18 },
  backBtn: { width: 70 },
  backText: { color: C.muted, fontSize: 16, fontWeight: '600' },
  topTitle: { fontSize: 18, fontWeight: '800' },
  steps: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stepDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  stepText: { color: C.text, fontWeight: '800' },
  stepLine: { width: 44, height: 3, backgroundColor: C.border, marginHorizontal: 4, borderRadius: 2 },
  levelLabel: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 18 },
  sentenceCard: { backgroundColor: C.card, borderWidth: 2, borderRadius: 20, paddingVertical: 20, paddingHorizontal: 12, width: '100%', minHeight: 140, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  wordsWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  wordChip: { alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6, marginHorizontal: 2 },
  wordText: { fontSize: 22, fontWeight: '700' },
  ipaText: { color: C.muted, fontSize: 13, marginTop: 2 },
  tapHint: { color: C.muted, fontSize: 12, marginTop: 8 },
  helperRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 },
  helperBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginHorizontal: 4, marginBottom: 6 },
  helperText: { color: C.text, fontSize: 13, fontWeight: '600' },
  micButton: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  micIcon: { fontSize: 40 },
  micHint: { color: C.muted, fontSize: 14, marginBottom: 10, textAlign: 'center' },
  heardText: { color: C.text, fontSize: 16, fontStyle: 'italic', textAlign: 'center', marginBottom: 12, minHeight: 22 },
  resultBox: { width: '100%', borderWidth: 1.5, borderRadius: 14, padding: 14, minHeight: 56, justifyContent: 'center', backgroundColor: C.card },
  resultText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  nextBtn: { paddingVertical: 15, paddingHorizontal: 30, borderRadius: 30, alignItems: 'center', marginTop: 16 },
  nextText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  winSoon: { color: C.good, fontSize: 16, fontWeight: '700', marginTop: 16 },

  // Win
  trophy: { fontSize: 110 },
  winTitle: { fontSize: 44, fontWeight: '900', letterSpacing: 2, marginTop: 6 },
  winSub: { color: C.muted, fontSize: 16, marginTop: 6 },
  starsRow: { flexDirection: 'row', marginTop: 22 },
  star: { fontSize: 52, marginHorizontal: 6 },
  winStats: { color: C.text, fontSize: 15, marginTop: 8, marginBottom: 20 },
});

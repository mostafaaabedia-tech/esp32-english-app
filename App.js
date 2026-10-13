import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, Animated, Easing, Vibration,
  PermissionsAndroid, Platform, ActivityIndicator, Dimensions, ScrollView, BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import { BleManager, State } from 'react-native-ble-plx';
import Voice from '@react-native-voice/voice';
import { DIFFICULTIES, STAGE_NAMES, stages } from './sentences';

// ───────────────────────── Constants ─────────────────────────
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea0730544b34';
const SCAN_TIMEOUT_MS = 10000;

// Base64 of the single characters 'c', 'w', 'r', 'v' (ble-plx needs base64 payloads).
const COMMANDS = { correct: 'Yw==', wrong: 'dw==', reset: 'cg==', win: 'dg==' };

const C = {
  bg: '#0f172a', card: '#1e293b', border: '#334155', text: '#f8fafc',
  muted: '#94a3b8', good: '#22c55e', bad: '#ef4444', blue: '#3b82f6',
};

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
];

// ───────────────────────── Helpers ─────────────────────────
const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[’‘']/g, '')
    .replace(/\b\d+\b/g, (n) => NUMBER_WORDS[Number(n)] ?? n)
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const matchedWords = (target, spoken) => {
  const a = target.split(' ');
  const b = spoken.split(' ');
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
};

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
function HomeScreen({ bleState, onBle, onStart, completed }) {
  const busy = bleState === 'scanning' || bleState === 'connecting';
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.logo}>🗣️</Text>
      <Text style={styles.title}>Speak It Right</Text>
      <Text style={styles.subtitle}>Read each sentence out loud. Pass 3 levels to win!</Text>

      <TouchableOpacity
        style={[styles.blePill, bleState === 'connected' && { backgroundColor: '#14532d', borderColor: C.good }]}
        onPress={onBle}
        disabled={busy}
        activeOpacity={0.8}
      >
        {busy && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
        <Text style={styles.blePillText}>{BLE_LABELS[bleState]}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>CHOOSE YOUR DIFFICULTY</Text>
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

// ───────────────────────── Game screen ─────────────────────────
function GameScreen({
  diff, stageIndex, sentence, result, listening,
  onMic, onHear, onSwap, onNext, onBack,
}) {
  const pop = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const isCorrect = result.kind === 'correct';
  const lastStage = stageIndex === 2;

  // Card pops in whenever the sentence changes
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, useNativeDriver: true }).start();
  }, [sentence, pop]);

  // Card shakes on a wrong answer
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

  // Mic pulses while listening
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
        <Text style={styles.sentenceText}>{sentence}</Text>
      </Animated.View>

      <View style={styles.helperRow}>
        <TouchableOpacity style={styles.helperBtn} onPress={onHear} disabled={listening}>
          <Text style={styles.helperText}>🔊 Hear it</Text>
        </TouchableOpacity>
        {!isCorrect && (
          <TouchableOpacity style={styles.helperBtn} onPress={onSwap} disabled={listening}>
            <Text style={styles.helperText}>🔀 Another one</Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.View style={{ transform: [{ scale: pulse }], marginVertical: 18 }}>
        <TouchableOpacity
          style={[styles.micButton, { backgroundColor: listening ? C.bad : diff.color }]}
          onPress={onMic}
          disabled={isCorrect}
          activeOpacity={0.85}
        >
          <Text style={styles.micIcon}>{listening ? '⏹' : '🎙️'}</Text>
        </TouchableOpacity>
      </Animated.View>
      <Text style={styles.micHint}>
        {listening ? 'Listening… tap to stop' : isCorrect ? 'Nice!' : 'Tap the mic and read the sentence'}
      </Text>

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
  const [result, setResult] = useState({ kind: 'idle', text: 'Ready when you are!', id: 0 });
  const [listening, setListening] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [bleState, setBleState] = useState('disconnected');
  const [completed, setCompleted] = useState({});

  const managerRef = useRef(null);
  if (!managerRef.current) managerRef.current = new BleManager();
  const deviceRef = useRef(null);
  const sentenceRef = useRef('');
  sentenceRef.current = sentence;
  const handlerRef = useRef(() => {});
  const timerRef = useRef(null);
  const resultId = useRef(0);

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

  // ── Speech result handler (re-created every render so it never goes stale) ──
  handlerRef.current = (alternatives) => {
    setListening(false);
    if (screen !== 'game' || result.kind === 'correct' || !alternatives.length) return;

    const target = normalize(sentenceRef.current);
    const targetCount = target.split(' ').length;
    let best = { spoken: '', score: -1 };
    for (const alt of alternatives) {
      const spoken = normalize(alt);
      const score = matchedWords(target, spoken);
      if (score > best.score || (score === best.score && spoken === target)) best = { spoken, score };
    }

    if (best.spoken === target) {
      setResult(makeResult('correct', stageIndex === 2 ? '🎉 PERFECT! Final level cleared!' : '✅ Correct! Well done.'));
      Vibration.vibrate(80);
      sendCommand('correct');
      if (stageIndex === 2) {
        timerRef.current = setTimeout(() => {
          setCompleted((prev) => ({ ...prev, [diffKey]: true }));
          setScreen('win');
          sendCommand('win');
        }, 1400);
      }
    } else {
      const pct = Math.round((best.score / targetCount) * 100);
      setMistakes((m) => m + 1);
      setResult(makeResult('wrong', `❌ Not quite (${pct}% of the words)\nYou said: "${best.spoken}"`));
      Vibration.vibrate([0, 60, 60, 60]);
      sendCommand('wrong');
    }
  };

  // ── Voice + cleanup ──
  useEffect(() => {
    Voice.onSpeechStart = () => setListening(true);
    Voice.onSpeechEnd = () => setListening(false);
    Voice.onSpeechError = (e) => {
      setListening(false);
      setResult((r) => (r.kind === 'correct' ? r : makeResult('error', "Didn't catch that. Tap the mic and try again.")));
      console.warn('Speech error', e?.error);
    };
    Voice.onSpeechResults = (e) => handlerRef.current(e?.value ?? []);

    const manager = managerRef.current;
    return () => {
      clearTimeout(timerRef.current);
      Speech.stop();
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
      deviceRef.current?.cancelConnection().catch(() => {});
      manager.destroy();
    };
  }, []);

  // ── Game flow ──
  const stopAudio = () => {
    Speech.stop();
    Voice.stop().catch(() => {});
    setListening(false);
  };

  const startGame = (key) => {
    clearTimeout(timerRef.current);
    stopAudio();
    setDiffKey(key);
    setStageIndex(0);
    setMistakes(0);
    setSentence(pickFrom(stages[key][0], ''));
    setResult(makeResult('idle', 'Ready when you are!'));
    setScreen('game');
    sendCommand('reset');
  };

  const nextStage = () => {
    const idx = stageIndex + 1;
    stopAudio();
    setStageIndex(idx);
    setSentence(pickFrom(stages[diffKey][idx], ''));
    setResult(makeResult('idle', 'Ready when you are!'));
    sendCommand('reset');
  };

  const swapSentence = () => {
    stopAudio();
    setSentence((s) => pickFrom(stages[diffKey][stageIndex], s));
    setResult(makeResult('idle', 'New sentence – you got this!'));
    sendCommand('reset');
  };

  const goHome = useCallback(() => {
    clearTimeout(timerRef.current);
    Speech.stop();
    Voice.stop().catch(() => {});
    setListening(false);
    setScreen('home');
    sendCommand('reset');
  }, [sendCommand]);

  const hearSentence = () => {
    Speech.stop();
    Speech.speak(sentence, { language: 'en-US', rate: 0.85 });
  };

  const toggleListening = async () => {
    try {
      if (listening) {
        await Voice.stop();
        return;
      }
      if (!(await requestMicPermission())) {
        Alert.alert('Microphone needed', 'Please allow microphone access to read aloud.');
        return;
      }
      Speech.stop();
      setResult(makeResult('listening', '🎙️ Listening…'));
      await Voice.start('en-US');
    } catch (e) {
      console.warn(e);
      setListening(false);
      setResult(makeResult('error', 'Speech recognition is unavailable on this device.'));
    }
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
        <HomeScreen bleState={bleState} onBle={connectBluetooth} onStart={startGame} completed={completed} />
      )}
      {screen === 'game' && (
        <GameScreen
          diff={diff}
          stageIndex={stageIndex}
          sentence={sentence}
          result={result}
          listening={listening}
          onMic={toggleListening}
          onHear={hearSentence}
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
  screen: { padding: 20, paddingTop: 56, alignItems: 'center' },

  // Home
  logo: { fontSize: 56 },
  title: { fontSize: 32, fontWeight: '800', color: C.text, marginTop: 4 },
  subtitle: { fontSize: 15, color: C.muted, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  blePill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 30, paddingVertical: 12, paddingHorizontal: 22, marginBottom: 28 },
  blePillText: { color: C.text, fontSize: 15, fontWeight: '600' },
  sectionLabel: { alignSelf: 'flex-start', color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
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
  sentenceCard: { backgroundColor: C.card, borderWidth: 2, borderRadius: 20, padding: 28, width: '100%', minHeight: 140, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  sentenceText: { color: C.text, fontSize: 24, fontWeight: '600', textAlign: 'center', lineHeight: 34 },
  helperRow: { flexDirection: 'row', marginTop: 14 },
  helperBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginHorizontal: 6 },
  helperText: { color: C.text, fontSize: 14, fontWeight: '600' },
  micButton: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  micIcon: { fontSize: 40 },
  micHint: { color: C.muted, fontSize: 14, marginBottom: 14 },
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

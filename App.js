import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert,
  PermissionsAndroid, Platform, ActivityIndicator,
} from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';
import Voice from '@react-native-voice/voice';
import { sentences, LEVELS } from './sentences';

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea0730544b34';
const SCAN_TIMEOUT_MS = 10000;

// Base64 of the single characters 'c', 'w', 'r' (ble-plx needs base64 payloads).
const COMMANDS = { correct: 'Yw==', wrong: 'dw==', reset: 'cg==' };

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
];

// Lowercase, drop apostrophes/punctuation, turn "12" into "twelve" (recognizers often return digits).
const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[’‘']/g, '')
    .replace(/\b\d+\b/g, (n) => NUMBER_WORDS[Number(n)] ?? n)
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Number of target words the speaker got right, in order.
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

const pickSentence = (level, avoid) => {
  const list = sentences[level];
  let next = avoid;
  while (next === avoid && list.length > 1) {
    next = list[Math.floor(Math.random() * list.length)];
  }
  return next;
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
  disconnected: 'Connect to ESP32',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: '✅ Connected (tap to disconnect)',
};

export default function App() {
  const [level, setLevel] = useState('Beginner');
  const [sentence, setSentence] = useState(() => pickSentence('Beginner', ''));
  const [result, setResult] = useState({ kind: 'idle', text: 'Tap "Read Sentence" and speak.' });
  const [bleState, setBleState] = useState('disconnected');
  const [listening, setListening] = useState(false);

  const managerRef = useRef(null);
  if (!managerRef.current) managerRef.current = new BleManager();
  const deviceRef = useRef(null);
  const sentenceRef = useRef(sentence); // lets Voice callbacks see the latest sentence
  sentenceRef.current = sentence;

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

  useEffect(() => {
    Voice.onSpeechStart = () => setListening(true);
    Voice.onSpeechEnd = () => setListening(false);
    Voice.onSpeechError = (e) => {
      setListening(false);
      setResult({ kind: 'error', text: "Didn't catch that. Please try again." });
      console.warn('Speech error', e?.error);
    };
    Voice.onSpeechResults = (e) => {
      setListening(false);
      const alternatives = e?.value ?? [];
      if (!alternatives.length) return;
      const target = normalize(sentenceRef.current);
      const targetCount = target.split(' ').length;

      // Use the best of the recognizer's alternatives.
      let best = { spoken: '', score: -1 };
      for (const alt of alternatives) {
        const spoken = normalize(alt);
        const score = matchedWords(target, spoken);
        if (score > best.score || (score === best.score && spoken === target)) best = { spoken, score };
      }

      if (best.spoken === target) {
        setResult({ kind: 'correct', text: '✅ CORRECT! Well done.' });
        sendCommand('correct');
      } else {
        const pct = Math.round((best.score / targetCount) * 100);
        setResult({ kind: 'wrong', text: `❌ Not quite (${pct}% of words).\nYou said: ${best.spoken}` });
        sendCommand('wrong');
      }
    };

    const manager = managerRef.current;
    return () => {
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
      deviceRef.current?.cancelConnection().catch(() => {});
      manager.destroy();
    };
  }, [sendCommand]);

  const showNewSentence = (nextLevel, current) => {
    setSentence(pickSentence(nextLevel, current));
    setResult({ kind: 'idle', text: 'Ready to listen…' });
    sendCommand('reset');
  };

  const changeLevel = (newLevel) => {
    setLevel(newLevel);
    showNewSentence(newLevel, sentence);
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
      setResult({ kind: 'listening', text: '🎙️ Listening…' });
      await Voice.start('en-US');
    } catch (e) {
      console.warn(e);
      setListening(false);
      setResult({ kind: 'error', text: 'Speech recognition is unavailable on this device.' });
    }
  };

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

  const busy = bleState === 'scanning' || bleState === 'connecting';
  const resultColor = { correct: '#1e8e3e', wrong: '#d93025', error: '#d93025' }[result.kind] ?? '#333';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🗣️ Speak-It-Right</Text>

      <TouchableOpacity
        style={[styles.bleButton, bleState === 'connected' && styles.bleConnected]}
        onPress={connectBluetooth}
        disabled={busy}
      >
        {busy && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
        <Text style={styles.btnText}>{BLE_LABELS[bleState]}</Text>
      </TouchableOpacity>

      <View style={styles.levelSelector}>
        {LEVELS.map((l) => (
          <TouchableOpacity
            key={l}
            style={[styles.levelBtn, level === l && styles.levelBtnActive]}
            onPress={() => changeLevel(l)}
          >
            <Text style={[styles.levelText, level === l && styles.levelTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sentenceCard}>
        <Text style={styles.sentenceText}>{sentence}</Text>
      </View>

      <TouchableOpacity
        style={[styles.micButton, listening && styles.micActive]}
        onPress={toggleListening}
      >
        <Text style={styles.btnText}>{listening ? '⏹ Stop' : '🎙️ Read Sentence'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.nextButton} onPress={() => showNewSentence(level, sentence)}>
        <Text style={styles.btnText}>Next Sentence</Text>
      </TouchableOpacity>

      <Text style={[styles.resultText, { color: resultColor }]}>{result.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', alignItems: 'center', padding: 20, paddingTop: 60 },
  title: { fontSize: 26, fontWeight: 'bold', marginBottom: 20 },
  bleButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#007bff', paddingVertical: 12, borderRadius: 10, width: '100%' },
  bleConnected: { backgroundColor: '#1e8e3e' },
  levelSelector: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginVertical: 20 },
  levelBtn: { flex: 1, marginHorizontal: 4, paddingVertical: 10, borderRadius: 8, backgroundColor: '#dfe3e8', alignItems: 'center' },
  levelBtnActive: { backgroundColor: '#007bff' },
  levelText: { fontSize: 14, fontWeight: '600', color: '#333' },
  levelTextActive: { color: '#fff' },
  sentenceCard: { backgroundColor: 'white', padding: 30, borderRadius: 15, width: '100%', alignItems: 'center', minHeight: 120, justifyContent: 'center', marginBottom: 20, elevation: 2 },
  sentenceText: { fontSize: 20, textAlign: 'center' },
  micButton: { backgroundColor: '#28a745', padding: 15, borderRadius: 30, width: '100%', alignItems: 'center', marginBottom: 12 },
  micActive: { backgroundColor: '#d93025' },
  nextButton: { backgroundColor: '#5f6368', padding: 12, borderRadius: 30, width: '100%', alignItems: 'center' },
  btnText: { color: 'white', fontSize: 17, fontWeight: 'bold' },
  resultText: { marginTop: 24, fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
});

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Alert, Animated, Vibration, PermissionsAndroid, Platform,
  ActivityIndicator, ScrollView, BackHandler, Image, Pressable, StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import * as Vosk from 'react-native-vosk';
import { BleManager, State } from 'react-native-ble-plx';
import { useFonts } from 'expo-font';
import { Lexend_400Regular } from '@expo-google-fonts/lexend/400Regular';
import { Lexend_500Medium } from '@expo-google-fonts/lexend/500Medium';
import { Lexend_600SemiBold } from '@expo-google-fonts/lexend/600SemiBold';
import { Lexend_700Bold } from '@expo-google-fonts/lexend/700Bold';

import { DIFFICULTIES, STAGE_NAMES, STAGE_COUNT, stages } from './sentences';
import { IPA } from './phonetics';
import { evaluate, liveProgress, heardWords, starsFor, toGrammarPhrase } from './checker';
import { C, MARK_COLORS, setFontsReady } from './theme';
import { T, Icon, Button, Rise, Stars, Bar, CountUp, PulseRings, Confetti } from './ui';
import {
  loadProgress, saveProgress, defaultProgress, recordPass, recordWords,
  totalStars, nextStage, DAILY_GOAL, MASTER_AFTER,
} from './storage';

// ───────────────────────── Constants ─────────────────────────
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea0730544b34';
const SCAN_TIMEOUT_MS = 10000;
const LAST_STAGE = STAGE_COUNT - 1;

// Base64 of the single characters 'c', 'w', 'r', 'v' (ble-plx needs base64 payloads).
const COMMANDS = { correct: 'Yw==', wrong: 'dw==', reset: 'cg==', win: 'dg==' };

// Offline speech engine (Vosk). The model folder is added to the APK by the GitHub build.
const MODEL_NAME = 'model-en-us';
const MAX_LISTEN_MS = 30000;       // longest time the mic stays open for one reading
const PAUSE_AFTER_SPEECH_MS = 2600; // silence after speaking that ends the reading (lets slow readers pause)
const NOTHING_HEARD_MS = 9000;     // give up when no word was heard at all

const LOGO = require('./assets/logo.png');
const CREDIT = 'Made by Mostafa Mesbah Abedi and Soliman Lodin';

const MODES = {
  guided: {
    label: 'Guided',
    desc: 'Listens for the words of this sentence. Best for learning and for noisy rooms.',
  },
  open: {
    label: 'Open',
    desc: 'Writes down whatever you say, then compares it. Harder, and shows the exact words it heard. Works best with the Relaxed pass mark in a quiet room.',
  },
};
const PASS_MARKS = [
  { value: 0.7, label: 'Relaxed', desc: '70% of the words' },
  { value: 0.85, label: 'Normal', desc: '85% of the words' },
  { value: 1, label: 'Perfect', desc: 'every word' },
];

// ───────────────────────── Helpers ─────────────────────────
const cleanWord = (w) => w.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z']/g, '');

const pickFrom = (list, avoid) => {
  let next = avoid;
  while (next === avoid && list.length > 1) next = list[Math.floor(Math.random() * list.length)];
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

const TOP_PAD = (RNStatusBar.currentHeight || 24) + 14;

// ───────────────────────── Reading card ─────────────────────────
// One word of the sentence. It is highlighted while it is being heard, then stamped
// green / amber / red when the reading has been checked.
function Word({ word, index, mark, lit, heard, showPhonetics, onPress }) {
  const stamp = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!mark) return;
    stamp.setValue(0.6);
    Animated.sequence([
      Animated.delay(index * 70),
      Animated.spring(stamp, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
    ]).start();
  }, [mark]); // eslint-disable-line react-hooks/exhaustive-deps

  const ipa = IPA[cleanWord(word)];
  const colors = mark ? MARK_COLORS[mark] : null;
  const bg = colors ? colors.bg : lit ? C.tealSoft : 'transparent';
  const fg = colors ? colors.fg : C.ink;
  const label = mark === 'missing' ? 'skipped' : heard ? `heard “${heard}”` : mark === 'wrong' ? 'not clear' : null;

  return (
    <Pressable onPress={() => onPress(cleanWord(word))} accessibilityLabel={`${word}. Tap to hear it.`}>
      <Animated.View style={[styles.word, { backgroundColor: bg, transform: [{ scale: stamp }] }]}>
        <T w="semi" style={[styles.wordText, { color: fg }, mark === 'missing' && styles.wordSkipped]}>{word}</T>
        {showPhonetics && !!ipa && <T style={[styles.ipa, colors && { color: fg }]}>/{ipa}/</T>}
        {!!label && mark !== 'ok' && <T w="medium" style={[styles.wordNote, { color: fg }]}>{label}</T>}
      </Animated.View>
    </Pressable>
  );
}

function ReadingCard({ sentence, marks, lit, heardFor, showPhonetics, onWordPress, tone }) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, useNativeDriver: true }).start();
  }, [sentence, pop]);
  const border = tone === 'pass' ? C.good : tone === 'fail' ? C.bad : C.line;
  return (
    <Animated.View
      style={[
        styles.readingCard,
        { borderColor: border, opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
      ]}
    >
      <View style={styles.marginLine} />
      <View style={styles.wordsWrap}>
        {words.map((w, i) => (
          <Word
            key={`${sentence}-${i}`}
            word={w}
            index={i}
            mark={marks ? marks[i] : null}
            lit={lit ? lit[i] : false}
            heard={heardFor ? heardFor[i] : null}
            showPhonetics={showPhonetics}
            onPress={onWordPress}
          />
        ))}
      </View>
    </Animated.View>
  );
}

// ───────────────────────── Microphone ─────────────────────────
function MicButton({ listening, color, disabled, onPress, size = 92 }) {
  const press = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(press, { toValue: v, friction: 5, useNativeDriver: true }).start();
  return (
    <View style={{ width: size * 1.9, height: size * 1.5, alignItems: 'center', justifyContent: 'center' }}>
      <PulseRings active={listening} color={C.bad} size={size} />
      <Pressable
        onPress={disabled ? undefined : onPress}
        onPressIn={() => to(0.93)}
        onPressOut={() => to(1)}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop listening' : 'Start reading aloud'}
      >
        <Animated.View
          style={[
            styles.mic,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: listening ? C.bad : color, opacity: disabled ? 0.4 : 1 },
            { transform: [{ scale: press }] },
          ]}
        >
          <Icon name={listening ? 'stop' : 'mic'} size={size * 0.42} color={C.white} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

// ───────────────────────── Small shared pieces ─────────────────────────
function Header({ title, subtitle, onBack, right }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to home" style={styles.headerBack}>
        <Icon name="chevron-back" size={26} color={C.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <T w="bold" style={styles.headerTitle}>{title}</T>
        {!!subtitle && <T style={styles.headerSub}>{subtitle}</T>}
      </View>
      {right}
    </View>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, on && styles.segmentItemOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <T w="semi" style={{ color: on ? C.white : C.muted, fontSize: 14 }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({ label, hint, value, onChange }) {
  const a = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [a, value]);
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <T w="medium" style={{ fontSize: 16 }}>{label}</T>
        {!!hint && <T style={styles.hint}>{hint}</T>}
      </View>
      <Animated.View style={[styles.switch, { backgroundColor: a.interpolate({ inputRange: [0, 1], outputRange: [C.line, C.teal] }) }]}>
        <Animated.View style={[styles.switchKnob, { transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} />
      </Animated.View>
    </Pressable>
  );
}

// ───────────────────────── Home ─────────────────────────
function HomeScreen({ progress, engine, engineError, onRetryEngine, bleState, onStart, onWords, onSettings }) {
  const trickyCount = Object.keys(progress.tricky).length;
  const goal = Math.min(1, progress.today.done / DAILY_GOAL);
  const flame = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(500),
      Animated.spring(flame, { toValue: 1.25, friction: 3, useNativeDriver: true }),
      Animated.spring(flame, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [flame]);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Rise>
        <View style={styles.homeTop}>
          <Image source={LOGO} style={styles.homeLogo} />
          <View style={{ flex: 1 }}>
            <T w="bold" style={styles.appName}>Speak It Right</T>
            <T style={styles.hint}>Read aloud. See every word you got right.</T>
          </View>
          <Pressable onPress={onSettings} hitSlop={10} accessibilityRole="button" accessibilityLabel="Settings" style={styles.roundBtn}>
            <Icon name="settings-outline" size={22} color={C.ink} />
          </Pressable>
        </View>
      </Rise>

      {engine !== 'ready' && (
        <Pressable onPress={engine === 'error' ? onRetryEngine : undefined} style={[styles.banner, engine === 'error' && { backgroundColor: C.badSoft }]}>
          {engine === 'loading' ? <ActivityIndicator color={C.ink} style={{ marginRight: 10 }} /> : <Icon name="warning" size={20} color={C.bad} style={{ marginRight: 10 }} />}
          <View style={{ flex: 1 }}>
            <T w="medium" style={{ fontSize: 14, color: engine === 'error' ? C.bad : C.ink }}>
              {engine === 'loading' ? 'Getting the offline listener ready. The first start takes a little longer.' : 'The listener could not start. Tap to try again.'}
            </T>
            {engine === 'error' && !!engineError && <T style={[styles.hint, { color: C.bad }]}>{engineError}</T>}
          </View>
        </Pressable>
      )}

      <Rise delay={80}>
        <View style={styles.todayCard}>
          <View style={styles.todayRow}>
            <View style={styles.todayStat}>
              <Animated.View style={{ transform: [{ scale: flame }] }}>
                <Icon name="flame" size={26} color={progress.streak.count > 0 ? C.gold : '#5D7799'} />
              </Animated.View>
              <View style={{ marginLeft: 8 }}>
                <CountUp value={progress.streak.count} style={styles.todayNumber} />
                <T style={styles.todayLabel}>{progress.streak.count === 1 ? 'day in a row' : 'days in a row'}</T>
              </View>
            </View>
            <View style={styles.todayStat}>
              <Icon name="flash" size={24} color={C.teal} />
              <View style={{ marginLeft: 8 }}>
                <CountUp value={progress.xp} style={styles.todayNumber} />
                <T style={styles.todayLabel}>points</T>
              </View>
            </View>
          </View>
          <T w="medium" style={styles.todayGoal}>
            {progress.today.done >= DAILY_GOAL
              ? 'Today’s goal is done. Keep going if you like.'
              : `Today: ${progress.today.done} of ${DAILY_GOAL} sentences`}
          </T>
          <Bar value={goal} color={C.teal} track="#2B4A75" />
        </View>
      </Rise>

      <Rise delay={160}>
        <T w="semi" style={styles.sectionTitle}>Choose a level of English</T>
      </Rise>
      {DIFFICULTIES.map((d, i) => {
        const row = progress.stars[d.key];
        const done = row.every((s) => s > 0);
        const next = nextStage(progress, d.key);
        return (
          <Rise key={d.key} delay={220 + i * 80}>
            <Pressable onPress={() => onStart(d.key)} style={({ pressed }) => [styles.diffCard, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityLabel={`${d.label}. ${d.desc}`}>
              <View style={[styles.diffTab, { backgroundColor: d.color }]} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <T w="bold" style={{ fontSize: 19 }}>{d.label}</T>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="star" size={15} color={C.gold} />
                    <T w="semi" style={{ fontSize: 14, marginLeft: 4, color: C.muted }}>{totalStars(progress, d.key)}/{STAGE_COUNT * 3}</T>
                  </View>
                </View>
                <T style={styles.hint}>{d.desc}</T>
                <View style={styles.pips}>
                  {row.map((s, k) => (
                    <View key={k} style={[styles.pip, s > 0 && { backgroundColor: d.color, borderColor: d.color }]}>
                      <T w="semi" style={{ fontSize: 12, color: s > 0 ? C.white : C.muted }}>{k + 1}</T>
                    </View>
                  ))}
                  <T w="medium" style={[styles.hint, { marginLeft: 6, marginTop: 0, color: d.color }]}>
                    {done ? 'Play again' : next === 0 ? 'Start' : `Continue at level ${next + 1}`}
                  </T>
                </View>
              </View>
              <Icon name="chevron-forward" size={22} color={C.muted} />
            </Pressable>
          </Rise>
        );
      })}

      <Rise delay={480}>
        <Pressable onPress={onWords} style={({ pressed }) => [styles.wordsRow, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
          <View style={styles.wordsIcon}><Icon name="bookmark" size={20} color={C.tealDeep} /></View>
          <View style={{ flex: 1 }}>
            <T w="semi" style={{ fontSize: 16 }}>Tricky words</T>
            <T style={styles.hint}>
              {trickyCount === 0 ? 'Words you miss are saved here to practise.' : `${trickyCount} ${trickyCount === 1 ? 'word' : 'words'} to practise`}
            </T>
          </View>
          <Icon name="chevron-forward" size={22} color={C.muted} />
        </Pressable>
      </Rise>

      <Rise delay={560}>
        <View style={styles.footer}>
          <View style={styles.chip}>
            <Icon name="bluetooth" size={14} color={bleState === 'connected' ? C.good : C.muted} />
            <T w="medium" style={{ fontSize: 12, marginLeft: 4, color: bleState === 'connected' ? C.good : C.muted }}>
              {bleState === 'connected' ? 'Lights connected' : 'Lights not connected'}
            </T>
          </View>
          <T style={styles.credit}>{CREDIT}</T>
        </View>
      </Rise>
    </ScrollView>
  );
}

// ───────────────────────── Play ─────────────────────────
function PlayScreen({
  diff, stageIndex, runStars, sentence, marks, lit, heardFor, result, listening, heard, engineReady,
  settings, onTogglePhonetics, onMic, onHear, onHearWord, onSwap, onNext, onBack,
}) {
  const passed = result.kind === 'pass';
  const lastStage = stageIndex === LAST_STAGE;
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (result.kind !== 'fail') return;
    shake.setValue(0);
    Animated.sequence([10, -10, 6, -6, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 55, useNativeDriver: true }))).start();
  }, [result.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title={diff.label} subtitle={`Level ${stageIndex + 1} of ${STAGE_COUNT}: ${STAGE_NAMES[stageIndex]}`} onBack={onBack} />

      <View style={styles.steps}>
        {Array.from({ length: STAGE_COUNT }, (_, i) => {
          const cleared = i < stageIndex || (i === stageIndex && passed);
          return (
            <React.Fragment key={i}>
              <View style={[styles.step, cleared && { backgroundColor: diff.color, borderColor: diff.color }, i === stageIndex && !cleared && { borderColor: diff.color, borderWidth: 3 }]}>
                {cleared ? <Icon name="checkmark" size={16} color={C.white} /> : <T w="semi" style={{ fontSize: 13, color: i === stageIndex ? diff.color : C.muted }}>{i + 1}</T>}
              </View>
              {i < STAGE_COUNT - 1 && <View style={[styles.stepLine, i < stageIndex && { backgroundColor: diff.color }]} />}
            </React.Fragment>
          );
        })}
      </View>

      <Animated.View style={{ transform: [{ translateX: shake }] }}>
        <ReadingCard
          sentence={sentence}
          marks={marks}
          lit={lit}
          heardFor={heardFor}
          showPhonetics={settings.phonetics}
          onWordPress={onHearWord}
          tone={passed ? 'pass' : result.kind === 'fail' ? 'fail' : null}
        />
      </Animated.View>

      <View style={styles.tools}>
        <Button small icon="volume-high" label="Listen" color={C.card} edge={C.line} textColor={C.ink} onPress={() => onHear(false)} disabled={listening} />
        <Button small icon="hourglass-outline" label="Slowly" color={C.card} edge={C.line} textColor={C.ink} onPress={() => onHear(true)} disabled={listening} />
        <Button small icon={settings.phonetics ? 'eye' : 'eye-off'} label="Sounds" color={C.card} edge={C.line} textColor={C.ink} onPress={onTogglePhonetics} />
        {!passed && <Button small icon="shuffle" label="Another" color={C.card} edge={C.line} textColor={C.ink} onPress={onSwap} disabled={listening} />}
      </View>

      {!passed && (
        <View style={{ alignItems: 'center' }}>
          <MicButton listening={listening} color={C.ink} disabled={!engineReady} onPress={onMic} />
          <T w="medium" style={styles.micHint}>
            {!engineReady
              ? 'The listener is still getting ready'
              : listening
              ? 'Listening. Take your time, tap when you finish.'
              : result.kind === 'fail' || result.kind === 'error'
              ? 'Tap the microphone to try again'
              : 'Tap the microphone and read the sentence'}
          </T>
          {listening && <T style={styles.heardText}>{heard ? `“${heard}”` : ' '}</T>}
        </View>
      )}

      {(result.kind === 'pass' || result.kind === 'fail') && (
        <Rise key={result.id}>
          <View style={[styles.resultCard, { borderColor: passed ? C.good : C.bad }]}>
            <View style={styles.resultTop}>
              <CountUp value={result.percent} suffix="%" style={[styles.resultPercent, { color: passed ? C.good : C.bad }]} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <T w="bold" style={{ fontSize: 18, color: passed ? C.good : C.bad }}>{result.title}</T>
                {passed ? <Stars count={result.stars} size={24} animate /> : <T style={styles.hint}>You need {Math.round(settings.passMark * 100)}% to pass</T>}
              </View>
              {passed && (
                <View style={styles.xpChip}>
                  <T w="bold" style={{ color: C.tealDeep, fontSize: 14 }}>+{result.xp}</T>
                </View>
              )}
            </View>
            <Bar value={result.percent / 100} color={passed ? C.good : C.bad} mark={settings.passMark < 1 ? settings.passMark : undefined} />
            {!!result.text && <T style={styles.resultText}>{result.text}</T>}
            {!!marks && marks.some((m) => m !== 'ok') && (
            <View style={styles.legend}>
              {[['ok', 'right'], ['close', 'almost'], ['wrong', 'missed']].map(([k, label]) => (
                <View key={k} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: MARK_COLORS[k].fg }]} />
                  <T style={{ fontSize: 12, color: C.muted }}>{label}</T>
                </View>
              ))}
            </View>
            )}
          </View>
        </Rise>
      )}
      {result.kind === 'error' && (
        <View style={[styles.resultCard, { borderColor: C.line }]}>
          <T w="medium" style={{ fontSize: 15 }}>{result.title}</T>
          {!!result.text && <T style={styles.hint}>{result.text}</T>}
        </View>
      )}

      {passed && (
        <Button
          label={lastStage ? 'See your result' : 'Next level'}
          icon="arrow-forward"
          color={diff.color}
          edge={diff.edge}
          onPress={onNext}
          style={{ marginTop: 16 }}
        />
      )}
      {runStars.some((s) => s > 0) && (
        <T style={[styles.hint, { textAlign: 'center', marginTop: 14 }]}>
          Stars this round: {runStars.reduce((a, b) => a + b, 0)}
        </T>
      )}
    </ScrollView>
  );
}

// ───────────────────────── Win ─────────────────────────
function WinScreen({ diff, runStars, nextDiff, onAgain, onNextDiff, onHome }) {
  const total = runStars.reduce((a, b) => a + b, 0);
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(lift, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }).start();
  }, [lift]);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.screen, { alignItems: 'center' }]}>
        <Animated.View style={[styles.trophy, { backgroundColor: diff.color, transform: [{ scale: lift }] }]}>
          <Icon name="trophy" size={64} color={C.white} />
        </Animated.View>
        <T w="bold" style={styles.winTitle}>You win!</T>
        <T style={[styles.hint, { fontSize: 16, textAlign: 'center' }]}>You read all {STAGE_COUNT} {diff.label} levels.</T>

        <View style={styles.winCard}>
          {runStars.map((s, i) => (
            <View key={i} style={styles.winRow}>
              <T w="medium" style={{ fontSize: 15, flex: 1 }}>{i + 1}. {STAGE_NAMES[i]}</T>
              <Stars count={s} size={20} />
            </View>
          ))}
          <View style={[styles.winRow, { borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 12 }]}>
            <T w="bold" style={{ fontSize: 16, flex: 1 }}>Stars this round</T>
            <CountUp value={total} suffix={` of ${STAGE_COUNT * 3}`} style={{ fontSize: 16, color: C.tealDeep }} />
          </View>
        </View>

        <View style={{ alignSelf: 'stretch' }}>
          <Button label="Play again" icon="refresh" color={diff.color} edge={diff.edge} onPress={onAgain} style={{ marginTop: 8 }} />
          {nextDiff && <Button label={`Try ${nextDiff.label}`} icon="arrow-up" color={nextDiff.color} edge={nextDiff.edge} onPress={onNextDiff} style={{ marginTop: 12 }} />}
          <Button label="Home" icon="home" color={C.card} edge={C.line} textColor={C.ink} onPress={onHome} style={{ marginTop: 12 }} />
        </View>
        <Image source={LOGO} style={{ width: 44, height: 44, marginTop: 24 }} />
        <T style={styles.credit}>{CREDIT}</T>
      </ScrollView>
      <Confetti />
    </View>
  );
}

// ───────────────────────── Tricky words ─────────────────────────
function WordsScreen({ tricky, selected, onSelect, result, listening, engineReady, onMic, onHear, onBack }) {
  const words = Object.keys(tricky).sort((a, b) => tricky[b].misses - tricky[a].misses || a.localeCompare(b));
  const current = selected && tricky[selected] ? selected : null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Tricky words" subtitle={`Say a word right ${MASTER_AFTER} times to clear it`} onBack={onBack} />

      {words.length === 0 && (
        <View style={styles.emptyCard}>
          <Icon name="checkmark-circle" size={44} color={C.good} />
          <T w="semi" style={{ fontSize: 18, marginTop: 10, textAlign: 'center' }}>
            {result.kind === 'pass' ? 'All cleared' : 'No tricky words yet'}
          </T>
          <T style={[styles.hint, { textAlign: 'center' }]}>
            When you miss a word while reading, it is saved here so you can practise it alone.
          </T>
          <Button label="Read a sentence" icon="book" onPress={onBack} style={{ marginTop: 16, alignSelf: 'stretch' }} />
        </View>
      )}

      {current && (
        <View style={styles.practiceCard}>
          <T w="bold" style={styles.practiceWord}>{current}</T>
          {!!IPA[current] && <T style={styles.practiceIpa}>/{IPA[current]}/</T>}
          <View style={styles.winsRow}>
            {Array.from({ length: MASTER_AFTER }, (_, i) => (
              <View key={i} style={[styles.winDot, i < tricky[current].wins && { backgroundColor: C.good, borderColor: C.good }]} />
            ))}
          </View>
          <View style={[styles.tools, { justifyContent: 'center' }]}>
            <Button small icon="volume-high" label="Listen" color={C.card} edge={C.line} textColor={C.ink} onPress={() => onHear(current, false)} disabled={listening} />
            <Button small icon="hourglass-outline" label="Slowly" color={C.card} edge={C.line} textColor={C.ink} onPress={() => onHear(current, true)} disabled={listening} />
          </View>
          <MicButton listening={listening} color={C.teal} disabled={!engineReady} onPress={onMic} size={76} />
          <T
            w="medium"
            style={[styles.micHint, result.kind === 'pass' && { color: C.good }, result.kind === 'fail' && { color: C.bad }]}
          >
            {listening ? 'Listening. Say the word.' : result.title || 'Tap the microphone and say the word'}
          </T>
        </View>
      )}

      {!current && words.length > 0 && result.kind === 'pass' && (
        <View style={[styles.practiceCard, { borderColor: C.good }]}>
          <Icon name="checkmark-circle" size={40} color={C.good} />
          <T w="semi" style={{ fontSize: 17, marginTop: 8, textAlign: 'center', color: C.good }}>{result.title}</T>
        </View>
      )}

      {words.length > 0 && (
        <>
          <T w="semi" style={styles.sectionTitle}>Your words</T>
          <View style={styles.chipWrap}>
            {words.map((w) => (
              <Pressable
                key={w}
                onPress={() => onSelect(w)}
                style={[styles.wordChip, w === current && styles.wordChipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: w === current }}
              >
                <T w="semi" style={{ fontSize: 15, color: w === current ? C.white : C.ink }}>{w}</T>
                <T style={{ fontSize: 11, marginLeft: 6, color: w === current ? '#CFE0F5' : C.muted }}>missed {tricky[w].misses}×</T>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ───────────────────────── Settings ─────────────────────────
function SettingsScreen({ settings, onChange, bleState, onBle, onReset, onBack }) {
  const busy = bleState === 'scanning' || bleState === 'connecting';
  const mark = PASS_MARKS.find((m) => m.value === settings.passMark) || PASS_MARKS[1];
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Settings" onBack={onBack} />

      <View style={styles.settingsCard}>
        <T w="semi" style={styles.settingsTitle}>How the app listens</T>
        <Segmented
          options={Object.keys(MODES).map((k) => ({ value: k, label: MODES[k].label }))}
          value={settings.mode}
          onChange={(v) => onChange({ mode: v })}
        />
        <T style={styles.hint}>{MODES[settings.mode].desc}</T>
      </View>

      <View style={styles.settingsCard}>
        <T w="semi" style={styles.settingsTitle}>How much must be right to pass</T>
        <Segmented options={PASS_MARKS} value={mark.value} onChange={(v) => onChange({ passMark: v })} />
        <T style={styles.hint}>
          {mark.label}: {mark.desc}. A word that is almost right (like “plants” for “plant”) counts for part of a word.
        </T>
      </View>

      <View style={styles.settingsCard}>
        <ToggleRow label="Show sounds under words" hint="The pronunciation of each word, in phonetic letters" value={settings.phonetics} onChange={(v) => onChange({ phonetics: v })} />
        <View style={styles.divider} />
        <ToggleRow label="Always speak slowly" hint="The Listen button reads at a slower speed" value={settings.slowVoice} onChange={(v) => onChange({ slowVoice: v })} />
      </View>

      <View style={styles.settingsCard}>
        <T w="semi" style={styles.settingsTitle}>ESP32 lights</T>
        <T style={[styles.hint, { marginBottom: 12 }]}>Green for a correct reading, red for a wrong one.</T>
        <Button
          label={{ disconnected: 'Connect the lights', scanning: 'Searching…', connecting: 'Connecting…', connected: 'Connected. Tap to disconnect' }[bleState]}
          icon="bluetooth"
          color={bleState === 'connected' ? C.good : C.ink}
          edge={bleState === 'connected' ? '#147647' : C.inkDeep}
          onPress={onBle}
          disabled={busy}
        />
      </View>

      <Button label="Erase my progress" icon="trash-outline" color={C.card} edge={C.line} textColor={C.bad} onPress={onReset} />
      <T style={[styles.credit, { marginTop: 22 }]}>{CREDIT}</T>
    </ScrollView>
  );
}

// ───────────────────────── App ─────────────────────────
const IDLE = { kind: 'idle', id: 0 };

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold, Lexend_700Bold });
  setFontsReady(fontsLoaded && !fontError);

  const [screen, setScreen] = useState('home'); // home | play | win | words | settings
  const [progress, setProgress] = useState(defaultProgress);
  const [diffKey, setDiffKey] = useState('Beginner');
  const [stageIndex, setStageIndex] = useState(0);
  const [runStars, setRunStars] = useState(() => new Array(STAGE_COUNT).fill(0));
  const [sentence, setSentence] = useState('');
  const [marks, setMarks] = useState(null);       // per word: ok | close | wrong | missing
  const [heardFor, setHeardFor] = useState(null); // per word: what was heard instead
  const [lit, setLit] = useState(null);           // per word: heard so far (live)
  const [result, setResult] = useState(IDLE);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [trickyWord, setTrickyWord] = useState(null);
  const [bleState, setBleState] = useState('disconnected');
  const [engine, setEngine] = useState('loading'); // loading | ready | error
  const [engineError, setEngineError] = useState('');

  const managerRef = useRef(null);
  if (!managerRef.current) managerRef.current = new BleManager();
  const deviceRef = useRef(null);
  const handlersRef = useRef({});
  const timerRef = useRef(null);
  const resultId = useRef(0);
  const attemptsRef = useRef(0);
  const sessionRef = useRef({ active: false, done: true });

  const settings = progress.settings;
  const diff = DIFFICULTIES.find((d) => d.key === diffKey);
  const makeResult = (r) => ({ ...r, id: ++resultId.current });

  // ── Saved progress ──
  useEffect(() => { setProgress(loadProgress()); }, []);
  const update = useCallback((fn) => {
    setProgress((prev) => {
      const next = fn(prev);
      saveProgress(next);
      return next;
    });
  }, []);
  const changeSettings = (patch) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));

  // ── ESP32 lights (Bluetooth) ──
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
        Alert.alert('Not found', 'Could not find “SpeakItRight”. Is the ESP32 powered on?');
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

  const clearSessionTimers = (s) => {
    clearTimeout(s.pauseTimer);
    clearTimeout(s.stopTimer);
    clearTimeout(s.hardTimer);
    clearTimeout(s.emptyTimer);
  };

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
      clearSessionTimers(sessionRef.current);
      Speech.stop();
      try { Vosk.unload(); } catch {}
      deviceRef.current?.cancelConnection().catch(() => {});
      manager.destroy();
    };
  }, [loadEngine]);

  // ── One listening session (used for sentences and for single words) ──
  // The mic stays open while the person reads. Pieces of speech are collected, so a pause in
  // the middle of the sentence does NOT end the reading. It ends when the whole target was
  // heard, after a longer silence, when the mic is tapped again, or at the time limit.
  const heardSoFar = (s) => [...s.segments, s.pending].filter(Boolean).join(' ');

  const finishSession = () => {
    const s = sessionRef.current;
    if (s.done) return;
    s.done = true;
    s.active = false;
    clearSessionTimers(s);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
    setLit(null);
    s.onDone(heardSoFar(s));
  };

  const cancelSession = () => {
    const s = sessionRef.current;
    s.active = false;
    s.done = true;
    clearSessionTimers(s);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
    setLit(null);
  };

  const afterSpeech = (s) => {
    const text = heardSoFar(s);
    setHeard(text.replace(/\[unk\]/g, '…'));
    s.onLive?.(text);
    clearTimeout(s.pauseTimer);
    if (!heardWords(text).length) return;            // nothing real yet: keep waiting
    clearTimeout(s.emptyTimer);
    if (s.isComplete(text)) s.pauseTimer = setTimeout(finishSession, 350);
    else s.pauseTimer = setTimeout(finishSession, PAUSE_AFTER_SPEECH_MS);
  };

  handlersRef.current = {
    partial: (text) => {
      const s = sessionRef.current;
      if (!s.active || text === s.pending) return;
      s.pending = text || '';
      afterSpeech(s);
    },
    result: (text) => {
      const s = sessionRef.current;
      if (!s.active) return;
      s.pending = '';
      if (text) s.segments.push(text);
      afterSpeech(s);
    },
    final: (text) => {
      const s = sessionRef.current;
      if (s.done || !s.stopping) return;
      s.pending = '';
      if (text) s.segments.push(text);
      finishSession();
    },
    timeout: () => finishSession(),
    error: (e) => {
      console.warn('Vosk error', e);
      const s = sessionRef.current;
      if (s.done) return;
      cancelSession();
      setResult(makeResult({ kind: 'error', title: 'The listener stopped unexpectedly.', text: 'Tap the microphone to try again.' }));
    },
  };

  const listen = async ({ target, guided, onLive, onDone }) => {
    const s = sessionRef.current;
    if (s.active) {
      // Tap while listening = "I am finished"
      s.stopping = true;
      try { Vosk.stop(); } catch {}
      s.stopTimer = setTimeout(finishSession, 700); // wait briefly for the last words
      return;
    }
    if (engine !== 'ready') return;
    if (!(await requestMicPermission())) {
      Alert.alert('Microphone needed', 'Please allow the microphone so the app can hear you read.');
      return;
    }

    Speech.stop();
    const session = {
      active: true, done: false, stopping: false,
      segments: [], pending: '',
      onLive, onDone,
      isComplete: (text) => evaluate(target, text, { passMark: 1 }).score >= 0.999,
    };
    sessionRef.current = session;
    setMarks(null);
    setHeardFor(null);
    setHeard('');
    setListening(true);
    setResult(makeResult({ kind: 'listening' }));
    session.hardTimer = setTimeout(finishSession, MAX_LISTEN_MS + 500);
    session.emptyTimer = setTimeout(finishSession, NOTHING_HEARD_MS);

    try {
      const options = { timeout: MAX_LISTEN_MS };
      // Guided: the recognizer only listens for the words of THIS target
      if (guided) options.grammar = [toGrammarPhrase(target), '[unk]'];
      await Vosk.start(options);
    } catch (e) {
      console.warn('Vosk.start failed', e);
      cancelSession();
      setResult(makeResult({ kind: 'error', title: 'The microphone could not start.', text: 'Close other apps that use the microphone and try again.' }));
    }
  };

  // ── Reading a sentence ──
  const judgeSentence = (text) => {
    if (!heardWords(text).length) {
      setResult(makeResult({ kind: 'error', title: 'I did not hear any words.', text: 'Hold the phone closer and speak a little louder.' }));
      return;
    }
    attemptsRef.current += 1;
    const res = evaluate(sentence, text, { passMark: settings.passMark });
    setMarks(res.wordStatus);
    setHeardFor(res.wordHeard);

    const words = sentence.split(/\s+/).filter(Boolean).map(cleanWord);
    const missed = words.filter((_, i) => res.wordStatus[i] === 'wrong' || res.wordStatus[i] === 'missing');
    const readWell = words.filter((_, i) => res.wordStatus[i] === 'ok');

    if (res.passed) {
      const stars = starsFor(res.percent, attemptsRef.current);
      const xp = 10 + stars * 5;
      update((p) => recordWords(recordPass(p, { diffKey, stageIndex, stars, xp }), { missed, readWell }));
      setRunStars((prev) => prev.map((v, i) => (i === stageIndex ? stars : v)));
      const note = res.closeWords.length
        ? `Almost right: ${res.closeWords.join(', ')}. Tap a word to hear it.`
        : missed.length
        ? `Saved to tricky words: ${missed.join(', ')}.`
        : '';
      setResult(makeResult({
        kind: 'pass', percent: res.percent, stars, xp, text: note,
        title: res.percent === 100 ? 'Perfect reading' : stageIndex === LAST_STAGE ? 'Final level cleared' : 'Well read',
      }));
      Vibration.vibrate(80);
      sendCommand('correct');
    } else {
      update((p) => recordWords(p, { missed, readWell: [] }));
      const parts = [];
      if (missed.length) parts.push(`Practise: ${missed.join(', ')}.`);
      if (res.closeWords.length) parts.push(`Almost right: ${res.closeWords.join(', ')}.`);
      if (res.extraWords.length) parts.push(`Extra words heard: ${res.extraWords.join(' ')}.`);
      parts.push('Tap a red word to hear it, then try again.');
      setResult(makeResult({ kind: 'fail', percent: res.percent, title: res.percent >= 60 ? 'Nearly there' : 'Not yet', text: parts.join(' ') }));
      Vibration.vibrate([0, 60, 60, 60]);
      sendCommand('wrong');
    }
  };

  const micForSentence = () =>
    listen({
      target: sentence,
      guided: settings.mode === 'guided',
      onLive: (text) => setLit(liveProgress(sentence, text)),
      onDone: judgeSentence,
    });

  // ── Practising one tricky word ──
  const judgeWord = (text) => {
    const word = trickyWord;
    if (!word) return;
    const said = heardWords(text);
    const res = evaluate(word, text, { passMark: 0.85 });
    if (res.passed) {
      const wins = (progress.tricky[word]?.wins || 0) + 1;
      const cleared = wins >= MASTER_AFTER;
      update((p) => {
        const next = recordWords(p, { readWell: [word] });
        return cleared ? { ...next, xp: next.xp + 5 } : next;
      });
      setResult(makeResult({ kind: 'pass', title: cleared ? `“${word}” is cleared. +5 points` : 'Right. Say it once more to clear it.' }));
      Vibration.vibrate(80);
      sendCommand('correct');
      if (cleared) {
        const rest = Object.keys(progress.tricky).filter((w) => w !== word);
        timerRef.current = setTimeout(() => setTrickyWord(rest[0] || null), 900);
      }
    } else {
      setResult(makeResult({
        kind: 'fail',
        title: said.length ? `Not yet. I heard “${said.join(' ')}”.` : 'That was not clear. Listen, then try again.',
      }));
      Vibration.vibrate([0, 60, 60, 60]);
      sendCommand('wrong');
    }
  };

  const micForWord = () => {
    if (!trickyWord) return;
    listen({ target: trickyWord, guided: true, onDone: judgeWord });
  };

  // ── Moving between sentences, levels and screens ──
  const resetReading = () => {
    setMarks(null);
    setHeardFor(null);
    setLit(null);
    setResult(IDLE);
    attemptsRef.current = 0;
    sendCommand('reset');
  };

  const startGame = (key) => {
    clearTimeout(timerRef.current);
    cancelSession();
    const start = nextStage(progress, key);
    setDiffKey(key);
    setStageIndex(start);
    setRunStars(progress.stars[key].map((s, i) => (i < start ? s : 0)));
    setSentence(pickFrom(stages[key][start], ''));
    resetReading();
    setScreen('play');
  };

  const nextLevel = () => {
    cancelSession();
    if (stageIndex === LAST_STAGE) {
      setScreen('win');
      sendCommand('win');
      return;
    }
    const idx = stageIndex + 1;
    setStageIndex(idx);
    setSentence(pickFrom(stages[diffKey][idx], ''));
    resetReading();
  };

  const playAgain = () => {
    cancelSession();
    setRunStars(new Array(STAGE_COUNT).fill(0));
    setStageIndex(0);
    setSentence(pickFrom(stages[diffKey][0], ''));
    resetReading();
    setScreen('play');
  };

  const swapSentence = () => {
    cancelSession();
    setSentence((s) => pickFrom(stages[diffKey][stageIndex], s));
    resetReading();
  };

  const goHome = useCallback(() => {
    clearTimeout(timerRef.current);
    Speech.stop();
    const s = sessionRef.current;
    s.active = false;
    s.done = true;
    clearTimeout(s.pauseTimer);
    clearTimeout(s.stopTimer);
    clearTimeout(s.hardTimer);
    clearTimeout(s.emptyTimer);
    try { Vosk.stop(); } catch {}
    setListening(false);
    setHeard('');
    setLit(null);
    setResult(IDLE);
    setScreen('home');
    sendCommand('reset');
  }, [sendCommand]);

  const openWords = () => {
    const words = Object.keys(progress.tricky).sort((a, b) => progress.tricky[b].misses - progress.tricky[a].misses);
    setTrickyWord(words[0] || null);
    setResult(IDLE);
    setScreen('words');
  };

  const selectWord = (w) => {
    cancelSession();
    setTrickyWord(w);
    setResult(IDLE);
  };

  const speak = (text, slow) => {
    if (!text) return;
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: slow || settings.slowVoice ? 0.55 : 0.9 });
  };

  const eraseProgress = () =>
    Alert.alert('Erase progress?', 'Your stars, points, streak and tricky words will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: () => update((p) => ({ ...defaultProgress(), settings: p.settings })) },
    ]);

  // Android back button goes home instead of closing the app
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

  if (!fontsLoaded && !fontError) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <Image source={LOGO} style={{ width: 96, height: 96 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {screen === 'home' && (
        <HomeScreen
          progress={progress}
          engine={engine}
          engineError={engineError}
          onRetryEngine={loadEngine}
          bleState={bleState}
          onStart={startGame}
          onWords={openWords}
          onSettings={() => setScreen('settings')}
        />
      )}
      {screen === 'play' && (
        <PlayScreen
          diff={diff}
          stageIndex={stageIndex}
          runStars={runStars}
          sentence={sentence}
          marks={marks}
          lit={lit}
          heardFor={heardFor}
          result={result}
          listening={listening}
          heard={heard}
          engineReady={engine === 'ready'}
          settings={settings}
          onTogglePhonetics={() => changeSettings({ phonetics: !settings.phonetics })}
          onMic={micForSentence}
          onHear={(slow) => speak(sentence, slow)}
          onHearWord={(w) => speak(w, true)}
          onSwap={swapSentence}
          onNext={nextLevel}
          onBack={goHome}
        />
      )}
      {screen === 'win' && (
        <WinScreen
          diff={diff}
          runStars={runStars}
          nextDiff={nextDiff}
          onAgain={playAgain}
          onNextDiff={() => startGame(nextDiff.key)}
          onHome={goHome}
        />
      )}
      {screen === 'words' && (
        <WordsScreen
          tricky={progress.tricky}
          selected={trickyWord}
          onSelect={selectWord}
          result={result}
          listening={listening}
          engineReady={engine === 'ready'}
          onMic={micForWord}
          onHear={speak}
          onBack={goHome}
        />
      )}
      {screen === 'settings' && (
        <SettingsScreen
          settings={settings}
          onChange={changeSettings}
          bleState={bleState}
          onBle={connectBluetooth}
          onReset={eraseProgress}
          onBack={goHome}
        />
      )}
    </View>
  );
}

// ───────────────────────── Styles ─────────────────────────
const shadow = { elevation: 2, shadowColor: '#12305A', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper, direction: 'ltr' },
  screen: { paddingHorizontal: 18, paddingTop: TOP_PAD, paddingBottom: 56 },
  hint: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  sectionTitle: { fontSize: 17, marginTop: 24, marginBottom: 10 },
  credit: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 8 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  headerBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: C.line },
  headerTitle: { fontSize: 22 },
  headerSub: { color: C.muted, fontSize: 13, marginTop: 1 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },

  // Home
  homeTop: { flexDirection: 'row', alignItems: 'center' },
  homeLogo: { width: 54, height: 54, marginRight: 12 },
  appName: { fontSize: 25, letterSpacing: -0.3 },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.tealSoft, borderRadius: 14, padding: 12, marginTop: 14 },
  todayCard: { backgroundColor: C.ink, borderRadius: 22, padding: 18, marginTop: 18 },
  todayRow: { flexDirection: 'row', marginBottom: 14 },
  todayStat: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  todayNumber: { color: C.white, fontSize: 26, lineHeight: 30 },
  todayLabel: { color: '#B5C6DC', fontSize: 12 },
  todayGoal: { color: C.white, fontSize: 14, marginBottom: 8 },
  diffCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 18, padding: 14, paddingLeft: 0, marginBottom: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden', ...shadow },
  diffTab: { width: 8, alignSelf: 'stretch', borderRadius: 4, marginRight: 14, marginLeft: 0 },
  pips: { flexDirection: 'row', alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
  pip: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginRight: 5 },
  wordsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 18, padding: 14, marginTop: 8, borderWidth: 1, borderColor: C.line },
  wordsIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.tealSoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  footer: { alignItems: 'center', marginTop: 26 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: C.line },

  // Play
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  step: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  stepLine: { width: 26, height: 3, backgroundColor: C.line, marginHorizontal: 3, borderRadius: 2 },
  readingCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 2, paddingVertical: 18, paddingRight: 12, paddingLeft: 34, minHeight: 150, justifyContent: 'center', overflow: 'hidden', ...shadow },
  marginLine: { position: 'absolute', left: 22, top: 0, bottom: 0, width: 2, backgroundColor: C.margin },
  wordsWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  word: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 5, marginRight: 3, marginBottom: 6 },
  wordText: { fontSize: 25, lineHeight: 32 },
  wordSkipped: { textDecorationLine: 'line-through' },
  ipa: { fontSize: 13, color: C.muted, marginTop: 1, fontFamily: undefined },
  wordNote: { fontSize: 11, marginTop: 2 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  mic: { alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#12305A', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  micHint: { color: C.muted, fontSize: 15, textAlign: 'center', marginTop: -4 },
  heardText: { fontSize: 16, color: C.tealDeep, textAlign: 'center', marginTop: 8, minHeight: 22 },
  resultCard: { backgroundColor: C.card, borderRadius: 18, borderWidth: 2, padding: 16, marginTop: 16 },
  resultTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  resultPercent: { fontSize: 40, lineHeight: 46, minWidth: 96 },
  resultText: { fontSize: 14, lineHeight: 21, color: C.ink, marginTop: 12 },
  xpChip: { backgroundColor: C.tealSoft, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 10 },
  legend: { flexDirection: 'row', marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  legendDot: { width: 9, height: 9, borderRadius: 5, marginRight: 5 },

  // Win
  trophy: { width: 128, height: 128, borderRadius: 64, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  winTitle: { fontSize: 38, marginTop: 14, textAlign: 'center' },
  winCard: { alignSelf: 'stretch', backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 16, marginVertical: 18 },
  winRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },

  // Tricky words
  emptyCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 22, alignItems: 'center' },
  practiceCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 18, alignItems: 'center', ...shadow },
  practiceWord: { fontSize: 38, textAlign: 'center' },
  practiceIpa: { fontSize: 18, color: C.muted, textAlign: 'center', marginTop: 2, fontFamily: undefined },
  winsRow: { flexDirection: 'row', marginTop: 10 },
  winDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: C.line, marginHorizontal: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wordChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 9, paddingHorizontal: 12 },
  wordChipOn: { backgroundColor: C.ink, borderColor: C.ink },

  // Settings
  settingsCard: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 16, marginBottom: 14 },
  settingsTitle: { fontSize: 16, marginBottom: 10 },
  segment: { flexDirection: 'row', backgroundColor: C.paper, borderRadius: 12, padding: 4, marginBottom: 6 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentItemOn: { backgroundColor: C.ink },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  switch: { width: 48, height: 28, borderRadius: 14, padding: 4 },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.white },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 12 },
});

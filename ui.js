// Small reusable pieces: text, buttons, stars, bars and motion helpers.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, Dimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { C, font } from './theme';

/** Text that is always left-to-right and uses the app font. w = regular | medium | semi | bold */
export function T({ w = 'regular', style, children, ...rest }) {
  return (
    <Text {...rest} style={[styles.text, font(w), style]}>
      {children}
    </Text>
  );
}

export const Icon = Ionicons;

/** Chunky button with a darker bottom edge that sinks when pressed. */
export function Button({ label, icon, onPress, color = C.ink, edge = C.inkDeep, textColor = C.white, disabled, small, style }) {
  const press = useRef(new Animated.Value(0)).current;
  const to = (v) => Animated.timing(press, { toValue: v, duration: 70, useNativeDriver: true }).start();
  const depth = small ? 3 : 5;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => !disabled && to(1)}
      onPressOut={() => to(0)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[{ opacity: disabled ? 0.45 : 1 }, style]}
    >
      <View style={[styles.btnEdge, { backgroundColor: edge, borderRadius: small ? 12 : 16, paddingBottom: depth }]}>
        <Animated.View
          style={[
            styles.btnFace,
            small && styles.btnFaceSmall,
            { backgroundColor: color, borderRadius: small ? 12 : 16 },
            { transform: [{ translateY: press.interpolate({ inputRange: [0, 1], outputRange: [0, depth] }) }] },
          ]}
        >
          {!!icon && <Ionicons name={icon} size={small ? 16 : 20} color={textColor} style={label ? { marginRight: 8 } : null} />}
          {!!label && <T w="semi" style={{ color: textColor, fontSize: small ? 14 : 17 }}>{label}</T>}
        </Animated.View>
      </View>
    </Pressable>
  );
}

/** Fades and lifts its children into place once, after `delay` ms. */
export function Rise({ delay = 0, children, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a, delay]);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Row of stars; earned ones pop in one after another when `animate` is set. */
export function Stars({ count = 0, total = 3, size = 22, animate = false }) {
  const anims = useRef(Array.from({ length: total }, () => new Animated.Value(animate ? 0 : 1))).current;
  useEffect(() => {
    if (!animate) return;
    anims.forEach((a) => a.setValue(0));
    Animated.stagger(180, anims.map((a) => Animated.spring(a, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }))).start();
  }, [animate, count]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ flexDirection: 'row' }} accessibilityLabel={`${count} of ${total} stars`}>
      {anims.map((a, i) => (
        <Animated.View key={i} style={{ transform: [{ scale: a }], marginRight: 2 }}>
          <Ionicons name={i < count ? 'star' : 'star-outline'} size={size} color={i < count ? C.gold : C.line} />
        </Animated.View>
      ))}
    </View>
  );
}

/** Horizontal bar that animates to `value` (0..1). `mark` draws a tick, e.g. the pass mark. */
export function Bar({ value, color = C.teal, height = 10, mark, track = C.line }) {
  const a = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    Animated.timing(a, { toValue: Math.max(0, Math.min(1, value)), duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [a, value]);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={{ height, borderRadius: height / 2, backgroundColor: color, width: a.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }} />
      {mark != null && width > 0 && <View style={{ position: 'absolute', left: width * mark - 1, top: 0, width: 2, height, backgroundColor: C.ink }} />}
    </View>
  );
}

/** A number that counts up to `value`. */
export function CountUp({ value, suffix = '', style, w = 'bold', duration = 700 }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = Date.now();
    const begin = from.current;
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(begin + (value - begin) * eased);
      setShown(v);
      if (t >= 1) { from.current = value; clearInterval(id); }
    }, 30);
    return () => clearInterval(id);
  }, [value, duration]);
  return <T w={w} style={style}>{shown}{suffix}</T>;
}

/** Two rings that grow out of the microphone while it is listening. */
export function PulseRings({ active, color, size }) {
  const rings = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    if (!active) { rings.forEach((r) => r.setValue(0)); return; }
    const loops = rings.map((r, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 600),
        Animated.timing(r, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]))
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color,
            opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
          }}
        />
      ))}
    </>
  );
}

/** Falling paper pieces for the win screen. */
export function Confetti({ count = 34 }) {
  const { width, height } = Dimensions.get('window');
  const colors = [C.teal, C.gold, C.good, C.ink, '#E86A5C'];
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => ({
      x: Math.random() * (width - 16),
      delay: Math.random() * 1600,
      duration: 2600 + Math.random() * 2200,
      color: colors[i % colors.length],
      w: 7 + Math.random() * 7,
      h: 10 + Math.random() * 10,
      spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
      anim: new Animated.Value(0),
    }))
  ).current;
  useEffect(() => {
    const loops = pieces.map((p) =>
      Animated.loop(Animated.timing(p.anim, { toValue: 1, duration: p.duration, delay: p.delay, easing: Easing.linear, useNativeDriver: true }))
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [pieces]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: p.x, top: -30, width: p.w, height: p.h, borderRadius: 2, backgroundColor: p.color,
            opacity: p.anim.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, height + 60] }) },
              { rotate: p.anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: C.ink, writingDirection: 'ltr', textAlign: 'left' },
  btnEdge: {},
  btnFace: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 20 },
  btnFaceSmall: { paddingVertical: 9, paddingHorizontal: 14 },
});

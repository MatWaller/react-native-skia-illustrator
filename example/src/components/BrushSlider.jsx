import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

const THUMB = 22;

export function BrushSlider({ min, max, value, onChange }) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);

  const setFromX = (x) => {
    const usable = Math.max(1, trackWRef.current - THUMB);
    const clamped = Math.max(0, Math.min(usable, x - THUMB / 2));
    const ratio = clamped / usable;
    onChange(Math.round(min + ratio * (max - min)));
  };
  const setFromXRef = useRef(setFromX);
  setFromXRef.current = setFromX;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setFromXRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromXRef.current(e.nativeEvent.locationX),
    })
  ).current;

  const usable = Math.max(1, trackW - THUMB);
  const ratio = (value - min) / (max - min);
  const left = ratio * usable;

  return (
    <View
      style={styles.sliderTrack}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        trackWRef.current = w;
        setTrackW(w);
      }}
      {...pan.panHandlers}
    >
      <View style={styles.sliderLine} pointerEvents="none" />
      <View
        style={[styles.sliderFill, { width: left + THUMB / 2 }]}
        pointerEvents="none"
      />
      <View style={[styles.sliderThumb, { left }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  sliderTrack: {
    flex: 1,
    height: 22,
    justifyContent: 'center',
  },
  sliderLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(99,102,241,0.95)',
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
});

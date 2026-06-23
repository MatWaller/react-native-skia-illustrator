import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

// MW - Full-screen white overlay with a centred spinner, shown while the Skia
// Canvas is initialising its GPU surface. Unmounts permanently once the canvas
// fires its first onLayout callback adding this so consuming apps don't have to manage their own loading state.

// TODO: MW - Add custom brand colour prop for skiaillustrator.

const LoadingOverlay = ({ visible }) => {
  if (!visible) return null;
  return (
    <View style={styles.overlay} pointerEvents="none">
      <ActivityIndicator size="large" color="#888888" />
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
});

export default LoadingOverlay;

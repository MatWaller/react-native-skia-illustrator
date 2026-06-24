import { Gesture } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const PADDING = 150;

export const createViewportGestures = ({
  currentTool,
  scale,
  savedScale,
  translateX,
  translateY,
  savedTranslateX,
  savedTranslateY,
  windowHeight,
  windowWidth,
  canvasWidth,
  canvasHeight,
}) => {
  // MW - Helper functions for canvas boundaries.
  const clampTranslations = (x, y, s) => {
    'worklet';
    const paperScaledWidth = canvasWidth * s;
    const paperScaledHeight = canvasHeight * s;

    // MW - Min x
    const minX = PADDING - paperScaledWidth;
    const maxX = windowWidth - PADDING;

    // MW - Min y
    const minY = PADDING - paperScaledHeight;
    const maxY = windowHeight - PADDING;

    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    };
  };

=  const prevPinchEventScale = makeMutable(1);
  const prevPinchFocalX = makeMutable(0);
  const prevPinchFocalY = makeMutable(0);

  const panViewportGesture = Gesture.Pan()
    .enabled(currentTool === 'move' || currentTool === 'selection')
    .maxPointers(1)
    .onBegin(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;

      // MW - Clamp the translation so we don't move the paper out of view.
      const clamped = clampTranslations(
        translateX.value,
        translateY.value,
        scale.value
      );
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchViewportGesture = Gesture.Pinch()
    .enabled(currentTool === 'move' || currentTool === 'selection')
    .onBegin((event) => {
      'worklet';
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      prevPinchEventScale.value = 1;
      prevPinchFocalX.value = event.focalX;
      prevPinchFocalY.value = event.focalY;
    })
    .onUpdate((event) => {
      'worklet';
      const scaleDelta = event.scale / prevPinchEventScale.value;
      const focalDX = event.focalX - prevPinchFocalX.value;
      const focalDY = event.focalY - prevPinchFocalY.value;

      // MW - First translate to follow the focal point's movement.
      let tx = translateX.value + focalDX;
      let ty = translateY.value + focalDY;

      // MW - Then scale around the new focal point.
      let nextScale = scale.value * scaleDelta;
      nextScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
      const actualScaleDelta = nextScale / scale.value;

      tx = event.focalX - (event.focalX - tx) * actualScaleDelta;
      ty = event.focalY - (event.focalY - ty) * actualScaleDelta;

      const clamped = clampTranslations(tx, ty, nextScale);

      scale.value = nextScale;
      translateX.value = clamped.x;
      translateY.value = clamped.y;

      prevPinchEventScale.value = event.scale;
      prevPinchFocalX.value = event.focalX;
      prevPinchFocalY.value = event.focalY;
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  return {
    panViewportGesture,
    pinchViewportGesture,
  };
};

import { Gesture } from 'react-native-gesture-handler';

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

  const panViewportGesture = Gesture.Pan()
    .enabled(currentTool === 'move' || currentTool === 'selection')
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
    .onBegin(() => {
      'worklet';
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      let nextScale = savedScale.value * event.scale;
      nextScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);

      const focalX = event.focalX;
      const focalY = event.focalY;

      // MW - Calculate the new translation so the focal point stays fixed on the paper.
      const targetX =
        focalX -
        (focalX - savedTranslateX.value) * (nextScale / savedScale.value);
      const targetY =
        focalY -
        (focalY - savedTranslateY.value) * (nextScale / savedScale.value);

      const clamped = clampTranslations(targetX, targetY, nextScale);

      // MW - Update the scale and translation values.
      scale.value = nextScale;
      translateX.value = clamped.x;
      translateY.value = clamped.y;
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

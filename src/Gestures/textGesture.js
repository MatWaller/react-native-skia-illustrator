import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';

export const createSelectionGestures = ({
  currentTool,
  scale,
  translateX,
  translateY,
  selectedShapeId,
  selectedShapeStart,
  shapes,
}) => {
  const getCanvasPoint = (x, y) => {
    'worklet';
    const currentScale = scale.value || 1;
    const tx = translateX.value || 0;
    const ty = translateY.value || 0;

    return {
      x: (x - tx) / currentScale,
      y: (y - ty) / currentScale,
    };
  };

  const panSelectionGesture = null;
  const rotateSelectionGesture = null;

  return {
    panSelectionGesture,
    rotateSelectionGesture,
  };
};

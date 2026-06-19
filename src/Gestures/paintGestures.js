import { Gesture } from 'react-native-gesture-handler';
import { Skia, notifyChange } from '@shopify/react-native-skia';
import { makeMutable, runOnJS } from 'react-native-reanimated';

export const createPaintGestures = ({
  currentTool,
  scale,
  translateX,
  translateY,
  activeStrokePath,
  activeStrokeColour,
  activeStrokeThickness,
  addPathToAllStrokes,
  cancelPendingReset,
}) => {
  const lastX = makeMutable(0);
  const lastY = makeMutable(0);

  const getCanvasPoint = (x, y) => {
    'worklet';
    return {
      x: (x - translateX.value) / scale.value,
      y: (y - translateY.value) / scale.value,
    };
  };

  const paintGesture = Gesture.Pan()
    .enabled(currentTool === 'paint' || currentTool === 'eraser')
    .minDistance(0)
    .maxPointers(1)
    .onStart((event) => {
      'worklet';
      // MW - Cancel any pending reset from the previous stroke so the
      // delayed timer can't wipe this fresh path mid-draw.
      if (cancelPendingReset) {
        runOnJS(cancelPendingReset)();
      }
      const pt = getCanvasPoint(event.x, event.y);
      const path = Skia.Path.Make();
      path.moveTo(pt.x, pt.y);
      activeStrokePath.value = path;
      lastX.value = pt.x;
      lastY.value = pt.y;
    })
    .onUpdate((event) => {
      'worklet';
      const path = activeStrokePath.value;
      if (!path) return;

      const { x, y } = getCanvasPoint(event.x, event.y);

      // MW - Defensive guard: if the path was reset out from under us
      // (no current point), restart it here instead of letting quadTo
      // inject an implicit moveTo(0,0) and draw a line from the corner.
      if (path.isEmpty()) {
        path.moveTo(x, y);
        lastX.value = x;
        lastY.value = y;
        notifyChange(activeStrokePath);
        return;
      }

      const midX = (lastX.value + x) / 2;
      const midY = (lastY.value + y) / 2;
      path.quadTo(lastX.value, lastY.value, midX, midY);
      lastX.value = x;
      lastY.value = y;
      notifyChange(activeStrokePath);
    })
    .onEnd(() => {
      'worklet';
      let isEraser = currentTool === 'eraser';
      runOnJS(addPathToAllStrokes)(
        activeStrokePath.value,
        activeStrokeColour.value,
        activeStrokeThickness.value,
        isEraser
      );
    });

  return { paintGesture };
};

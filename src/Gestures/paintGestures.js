import { Gesture } from 'react-native-gesture-handler';
import { Skia, notifyChange } from '@shopify/react-native-skia';
import { makeMutable, runOnJS } from 'react-native-reanimated';

export const createPaintGestures = ({
  currentTool,
  scale,
  shapes,
  translateX,
  translateY,
  activeStrokePath,
  activeStrokeColour,
  activeStrokeThickness,
  addPathToAllStrokes,
}) => {
  const lastX = makeMutable(0);
  const lastY = makeMutable(0);
  const startPressure = makeMutable(1);
  const lastPressure = makeMutable(1);
  const isStylusInput = makeMutable(false);

  const getPressure = (event) => {
    'worklet';
    const pressure = event.pressure ?? event.stylusData?.pressure ?? 1;
    return pressure > 0 ? pressure : 1;
  };

  const getIsStylusInput = (event) => {
    'worklet';
    return event.pointerType === 'stylus' || event.stylusData != null;
  };

  const getCanvasPoint = (x, y) => {
    'worklet';
    return {
      x: (x - translateX.value) / scale.value,
      y: (y - translateY.value) / scale.value,
    };
  };

  const paintGesture = Gesture.Pan()
    .enabled(
      currentTool === 'paint' ||
        currentTool === 'eraser' ||
        currentTool === 'highlighter'
    )
    .minDistance(0)
    .maxPointers(1)
    .onStart((event) => {
      'worklet';
      const pt = getCanvasPoint(event.x, event.y);
      const path = Skia.Path.Make();
      path.moveTo(pt.x, pt.y);
      activeStrokePath.value = path;
      lastX.value = pt.x;
      lastY.value = pt.y;
      startPressure.value = getPressure(event);
      lastPressure.value = startPressure.value;
      isStylusInput.value = getIsStylusInput(event);
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
      lastPressure.value = getPressure(event);
      if (getIsStylusInput(event)) {
        isStylusInput.value = true;
      }
      notifyChange(activeStrokePath);
    })
    .onEnd(() => {
      'worklet';
      let isEraser = currentTool === 'eraser';
      let isHighlighter = currentTool === 'highlighter';
      const completedPath = activeStrokePath.value;
      if (!completedPath) return;
      runOnJS(addPathToAllStrokes)(
        completedPath,
        activeStrokeColour.value,
        activeStrokeThickness.value,
        isEraser,
        isHighlighter,
        {
          isStylus: isStylusInput.value,
          startPressure: startPressure.value,
          endPressure: lastPressure.value,
        }
      );
      activeStrokePath.value = Skia.Path.Make();
      notifyChange(activeStrokePath);
    });

  return { paintGesture };
};

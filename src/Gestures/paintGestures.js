import { Gesture } from 'react-native-gesture-handler';
import { Skia, notifyChange } from '@shopify/react-native-skia';
import { makeMutable, runOnJS } from 'react-native-reanimated';

export const createPaintGestures = ({
  currentTool,
  scale,
  shapes,
  translateX,
  translateY,
  canvasWidth,
  canvasHeight,
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
  // MW - Whether the previous sample landed on the paper. Used to start a new
  // subpath (moveTo) when the finger re-enters, so no connecting line is drawn
  // across the region travelled outside the canvas.
  const wasOnCanvas = makeMutable(false);

  const isOnCanvas = (x, y) => {
    'worklet';
    return (
      x >= 0 && y >= 0 && x <= (canvasWidth ?? 0) && y <= (canvasHeight ?? 0)
    );
  };

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
      // MW - Strokes only exist on the paper. Starting off-paper creates an
      // empty path; the first on-paper sample in onUpdate will moveTo there.
      const path = Skia.Path.Make();
      if (isOnCanvas(pt.x, pt.y)) {
        path.moveTo(pt.x, pt.y);
        lastX.value = pt.x;
        lastY.value = pt.y;
        wasOnCanvas.value = true;
      } else {
        wasOnCanvas.value = false;
      }
      activeStrokePath.value = path;
      startPressure.value = getPressure(event);
      lastPressure.value = startPressure.value;
      isStylusInput.value = getIsStylusInput(event);
    })
    .onUpdate((event) => {
      'worklet';
      const path = activeStrokePath.value;
      if (!path) return;

      const { x, y } = getCanvasPoint(event.x, event.y);

      // MW - Ignore samples outside the paper entirely; remember we left so
      // the next on-paper sample starts a fresh subpath instead of drawing a
      // line across the gap.
      if (!isOnCanvas(x, y)) {
        wasOnCanvas.value = false;
        return;
      }

      // MW - Re-entry (or a path reset out from under us): start a new
      // subpath here instead of letting quadTo inject an implicit
      // moveTo(0,0) / connect across the off-paper gap.
      if (!wasOnCanvas.value || path.isEmpty()) {
        path.moveTo(x, y);
        lastX.value = x;
        lastY.value = y;
        wasOnCanvas.value = true;
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
      // MW - Nothing was drawn on the paper (gesture stayed off-canvas):
      // discard instead of committing an empty stroke + history entry.
      if (completedPath.isEmpty()) {
        activeStrokePath.value = Skia.Path.Make();
        notifyChange(activeStrokePath);
        return;
      }
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
      // MW - Intentionally do NOT reset activeStrokePath here. The finished
      // stroke stays painted in the active slot until SkiaIllustrator has
      // committed it into allStrokesPath and rendered it, at which point it
      // clears the active slot in the same commit. Resetting here caused a
      // frame where neither the active nor the committed path was painted,
      // which showed up as a flash on release (paint + highlighter).
    });

  return { paintGesture };
};

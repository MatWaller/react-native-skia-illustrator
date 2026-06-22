import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';
import { runOnJS } from 'react-native-reanimated';

export const createTextGestures = ({
  currentTool,
  scale,
  translateX,
  translateY,
  selectedShapeId,
  selectedShapeStart,
  selectedShapeBounds,
  selectedShapeRotation,
  shapes,
  onSelectedShapeChange,
  addText,  
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

  const hitTestText = (shape, px, py) => {
    'worklet';
    const w = shape.width ?? 0;
    const h = shape.height ?? shape.fontSize ?? 32;
    const rotationInRadians = ((shape.rotation ?? 0) * Math.PI) / 180;

    const centerX = shape.x + w / 2;
    const centerY = shape.y - h / 2;

    const translatedX = px - centerX;
    const translatedY = py - centerY;

    const cosA = Math.cos(-rotationInRadians);
    const sinA = Math.sin(-rotationInRadians);

    const rotatedX = translatedX * cosA - translatedY * sinA + centerX;
    const rotatedY = translatedX * sinA + translatedY * cosA + centerY;

    return (
      rotatedX >= shape.x &&
      rotatedX <= shape.x + w &&
      rotatedY >= shape.y - h &&
      rotatedY <= shape.y
    );
  };

  const placeTextGesture = Gesture.Tap()
    .enabled(currentTool === 'text')
    .onStart((event) => {
      'worklet';

      const { x, y } = getCanvasPoint(event.x, event.y);

      if (x < 0 || y < 0) {
        // MW - Ignore taps that are outside the canvas bounds (can happen if the user taps the toolbar or status bar).
        return;
      }

      const currentShapes = shapes.value;

      for (let i = currentShapes.length - 1; i >= 0; i--) {
        const shape = currentShapes[i];

        if (shape.type !== 'text' || !hitTestText(shape, x, y)) {
          continue;
        }

        const textHeight = shape.height ?? shape.fontSize ?? 32;
        selectedShapeId.value = shape.id;
        selectedShapeStart.value = { x: shape.x, y: shape.y };
        selectedShapeBounds.value = {
          x: shape.x,
          y: shape.y - textHeight,
          width: shape.width ?? 0,
          height: textHeight,
        };

        selectedShapeRotation.value = shape.rotation || 0;
        notifyChange(selectedShapeId);
        notifyChange(selectedShapeBounds);
        notifyChange(selectedShapeRotation);

        if (onSelectedShapeChange) {
          runOnJS(onSelectedShapeChange)(shape.id);
        }
        return;
      }

      // MW - Hand the canvas-space point to the JS thread, where the cached
      // Skia typeface lives, so the new text shape is created with measured
      // glyph dimensions (see addText in SkiaIllustrator).
      runOnJS(addText)(x, y);
    });

  return {
    placeTextGesture,
  };
};

import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';
import { makeMutable, runOnJS } from 'react-native-reanimated';

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const PADDING = 150;

export const createControlGestures = ({
  scale,
  savedScale,
  translateX,
  translateY,
  savedTranslateX,
  savedTranslateY,
  windowWidth,
  windowHeight,
  canvasWidth,
  canvasHeight,
  selectedShapeId,
  selectedShapeStart,
  selectedShapeBounds,
  selectedShapeRotation,
  shapes,
  onSelectedShapeChange,
  onBeforeShapeMutation = null,
}) => {
  const clampTranslations = (x, y, s) => {
    'worklet';
    return {
      x: Math.min(
        Math.max(x, PADDING - canvasWidth * s),
        windowWidth - PADDING
      ),
      y: Math.min(
        Math.max(y, PADDING - canvasHeight * s),
        windowHeight - PADDING
      ),
    };
  };

  const getCanvasPoint = (x, y) => {
    'worklet';
    return {
      x: (x - (translateX.value || 0)) / (scale.value || 1),
      y: (y - (translateY.value || 0)) / (scale.value || 1),
    };
  };

  // -- Hit test helpers (mirrors selectionGestures) --

  const hitTestCircle = (shape, px, py) => {
    'worklet';
    const dx = px - shape.x;
    const dy = py - shape.y;
    return dx * dx + dy * dy <= shape.radius * shape.radius;
  };

  const hitTestRect = (shape, px, py) => {
    'worklet';
    const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const cosA = Math.cos(-rot);
    const sinA = Math.sin(-rot);
    const tx = px - cx;
    const ty = py - cy;
    const rx = tx * cosA - ty * sinA + cx;
    const ry = tx * sinA + ty * cosA + cy;
    return (
      rx >= shape.x &&
      rx <= shape.x + shape.width &&
      ry >= shape.y &&
      ry <= shape.y + shape.height
    );
  };

  const hitTestLine = (shape, px, py) => {
    'worklet';
    const padding = 10;
    const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const cosA = Math.cos(-rot);
    const sinA = Math.sin(-rot);
    const tx = px - cx;
    const ty = py - cy;
    const rx = tx * cosA - ty * sinA + cx;
    const ry = tx * sinA + ty * cosA + cy;
    return (
      rx >= shape.x - padding &&
      rx <= shape.x + shape.width + padding &&
      ry >= shape.y - padding &&
      ry <= shape.y + shape.height + padding
    );
  };

  const hitTestText = (shape, px, py) => {
    'worklet';
    const w = shape.width ?? 0;
    const h = shape.height ?? shape.fontSize ?? 32;
    const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
    const cx = shape.x + w / 2;
    const cy = shape.y - h / 2;
    const cosA = Math.cos(-rot);
    const sinA = Math.sin(-rot);
    const tx = px - cx;
    const ty = py - cy;
    const rx = tx * cosA - ty * sinA + cx;
    const ry = tx * sinA + ty * cosA + cy;
    return (
      rx >= shape.x && rx <= shape.x + w && ry >= shape.y - h && ry <= shape.y
    );
  };

  const hitTestShape = (shape, px, py) => {
    'worklet';
    if (shape.type === 'circle') return hitTestCircle(shape, px, py);
    if (shape.type === 'text') return hitTestText(shape, px, py);
    if (shape.type === 'line') return hitTestLine(shape, px, py);
    return hitTestRect(shape, px, py);
  };

  const getShapeBounds = (shape) => {
    'worklet';
    if (shape.type === 'circle') {
      return {
        x: shape.x - shape.radius,
        y: shape.y - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2,
      };
    }
    if (shape.type === 'text') {
      const h = shape.height ?? shape.fontSize ?? 32;
      return { x: shape.x, y: shape.y - h, width: shape.width ?? 0, height: h };
    }
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  };

  const isPanningViewport = makeMutable(false);

  const controlPanGesture = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .onBegin((event) => {
      'worklet';
      const { x, y } = getCanvasPoint(event.x, event.y);
      let hitId = null;
      const currentShapes = shapes.value;

      for (let i = currentShapes.length - 1; i >= 0; i--) {
        const shape = currentShapes[i];
        if (hitTestShape(shape, x, y)) {
          hitId = shape.id;
          selectedShapeStart.value = { x: shape.x, y: shape.y };
          selectedShapeBounds.value = getShapeBounds(shape);
          selectedShapeRotation.value =
            shape.type === 'circle' ? 0 : shape.rotation || 0;
          break;
        }
      }

      if (hitId) {
        // Touching a shape — set up shape drag.
        isPanningViewport.value = false;
      } else if (selectedShapeId.value == null) {
        isPanningViewport.value = true;
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      } else {
        isPanningViewport.value = false;
        selectedShapeBounds.value = { x: 0, y: 0, width: 0, height: 0 };
        selectedShapeRotation.value = 0;
      }

      selectedShapeId.value = hitId;
      if (hitId && onBeforeShapeMutation) {
        runOnJS(onBeforeShapeMutation)(shapes.value.map((s) => ({ ...s })));
      }
      if (onSelectedShapeChange) {
        runOnJS(onSelectedShapeChange)(hitId);
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (selectedShapeId.value) {
        // Shape drag
        const newX =
          selectedShapeStart.value.x + event.translationX / scale.value;
        const newY =
          selectedShapeStart.value.y + event.translationY / scale.value;
        const currentShapes = shapes.value;
        for (let i = 0; i < currentShapes.length; i++) {
          if (currentShapes[i].id === selectedShapeId.value) {
            currentShapes[i].x = newX;
            currentShapes[i].y = newY;
            selectedShapeBounds.value = getShapeBounds(currentShapes[i]);
            break;
          }
        }
        shapes.value = [...currentShapes];
        notifyChange(shapes);
        notifyChange(selectedShapeBounds);
        notifyChange(selectedShapeRotation);
      } else if (isPanningViewport.value) {
        // Viewport pan
        const tx = savedTranslateX.value + event.translationX;
        const ty = savedTranslateY.value + event.translationY;
        const clamped = clampTranslations(tx, ty, scale.value);
        translateX.value = clamped.x;
        translateY.value = clamped.y;
      }
    })
    .onEnd(() => {
      'worklet';
      if (isPanningViewport.value) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
      isPanningViewport.value = false;
    });

  const controlPinchGesture = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      if (selectedShapeId.value != null) return;
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      // MW - When a shape is selected, pinch should not zoom/pan the viewport.
      if (selectedShapeId.value != null) return;
      let nextScale = savedScale.value * event.scale;
      nextScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
      const focalX = event.focalX;
      const focalY = event.focalY;
      const targetX =
        focalX -
        (focalX - savedTranslateX.value) * (nextScale / savedScale.value);
      const targetY =
        focalY -
        (focalY - savedTranslateY.value) * (nextScale / savedScale.value);
      const clamped = clampTranslations(targetX, targetY, nextScale);
      scale.value = nextScale;
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      'worklet';
      if (selectedShapeId.value != null) return;
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const controlRotateGesture = Gesture.Rotation()
    .onBegin(() => {
      'worklet';
      if (selectedShapeId.value && onBeforeShapeMutation) {
        runOnJS(onBeforeShapeMutation)(shapes.value.map((s) => ({ ...s })));
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (!selectedShapeId.value) return;
      const currentShapes = shapes.value;
      for (let i = 0; i < currentShapes.length; i++) {
        if (currentShapes[i].id === selectedShapeId.value) {
          currentShapes[i].rotation =
            (currentShapes[i].rotation ?? 0) + event.rotation;
          selectedShapeRotation.value = currentShapes[i].rotation;
          break;
        }
      }
      shapes.value = [...currentShapes];
      notifyChange(shapes);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);
    });

  return {
    controlPanGesture,
    controlPinchGesture,
    controlRotateGesture,
  };
};

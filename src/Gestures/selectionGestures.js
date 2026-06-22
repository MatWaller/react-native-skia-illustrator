import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';
import { runOnJS } from 'react-native-reanimated';

export const createSelectionGestures = ({
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
  onBeforeShapeMutation = null,
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

  const hitTestCircle = (shape, px, py) => {
    'worklet';
    const dx = px - shape.x;
    const dy = py - shape.y;
    return dx * dx + dy * dy <= shape.radius * shape.radius;
  };

  const hitTestRect = (shape, px, py) => {
    'worklet';
    const rotationInRadians = ((shape.rotation ?? 0) * Math.PI) / 180;
    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;
    const tx = px - centerX;
    const ty = py - centerY;
    const cosA = Math.cos(-rotationInRadians);
    const sinA = Math.sin(-rotationInRadians);
    const rx = tx * cosA - ty * sinA + centerX;
    const ry = tx * sinA + ty * cosA + centerY;
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
    const rotationInRadians = ((shape.rotation ?? 0) * Math.PI) / 180;
    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;
    const tx = px - centerX;
    const ty = py - centerY;
    const cosA = Math.cos(-rotationInRadians);
    const sinA = Math.sin(-rotationInRadians);
    const rx = tx * cosA - ty * sinA + centerX;
    const ry = tx * sinA + ty * cosA + centerY;
    return (
      rx >= shape.x - padding &&
      rx <= shape.x + shape.width + padding &&
      ry >= shape.y - padding &&
      ry <= shape.y + shape.height + padding
    );
  };

  // MW - Rotation-aware hit test for text. Text draws from its baseline so its
  // box spans (y - height)..y vertically and x..(x + width) horizontally.
  const hitTestText = (shape, px, py) => {
    'worklet';
    const w = shape.width ?? 0;
    const h = shape.height ?? shape.fontSize ?? 32;
    const rotationInRadians = ((shape.rotation ?? 0) * Math.PI) / 180;
    const centerX = shape.x + w / 2;
    const centerY = shape.y - h / 2;
    const tx = px - centerX;
    const ty = py - centerY;
    const cosA = Math.cos(-rotationInRadians);
    const sinA = Math.sin(-rotationInRadians);
    const rx = tx * cosA - ty * sinA + centerX;
    const ry = tx * sinA + ty * cosA + centerY;
    return rx >= shape.x && rx <= shape.x + w && ry >= shape.y - h && ry <= shape.y;
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

  const tapSelectionGesture = Gesture.Tap()
    .enabled(currentTool === 'selection' || currentTool === 'move')
    .onStart((event) => {
      'worklet';

      const { x, y } = getCanvasPoint(event.x, event.y);
      let hitId = null;
      const currentShapes = shapes.value;

      for (let i = currentShapes.length - 1; i >= 0; i--) {
        if (hitTestShape(currentShapes[i], x, y)) {
          hitId = currentShapes[i].id;
          break;
        }
      }

      selectedShapeId.value = hitId;
      if (onSelectedShapeChange) {
        runOnJS(onSelectedShapeChange)(hitId);
      }
    });

  const panSelectionGesture = Gesture.Pan()
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
          selectedShapeRotation.value = shape.type === 'circle' ? 0 : (shape.rotation || 0);
          break;
        }
      }

      if (!hitId) {
        selectedShapeId.value = null;
        selectedShapeStart.value = { x: 0, y: 0 };
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
      if (!selectedShapeId.value) return;

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
    })
    .onEnd(() => {
      'worklet';
      // Don't clear selection on gesture end - let the context menu handle it
      // selectedShapeId.value = null;
    });

  const rotateSelectionGesture = Gesture.Rotation()
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
          currentShapes[i].rotation += event.rotation;
          // MW - Keep the outline rotation in sync with the shape.
          selectedShapeRotation.value = currentShapes[i].rotation;
          break;
        }
      }

      shapes.value = [...currentShapes];

      notifyChange(shapes);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);
    })
    .onEnd(() => {
      'worklet';
      // Don't clear selection on gesture end - let the context menu handle it
      // selectedShapeId.value = null;
    });

  return {
    panSelectionGesture,
    tapSelectionGesture,
    rotateSelectionGesture,
  };
};

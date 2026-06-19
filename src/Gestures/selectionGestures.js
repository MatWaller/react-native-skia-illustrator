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

  const panSelectionGesture = Gesture.Pan()
    .enabled(currentTool === 'selection')
    .onBegin((event) => {
      'worklet';

      // TODO: Apply rotation to the hit test. Currently, it only works for unrotated rectangles.

      const { x, y } = getCanvasPoint(event.x, event.y);
      let hitId = null;

      const currentShapes = shapes.value;

      for (let i = currentShapes.length - 1; i >= 0; i--) {
        const shape = currentShapes[i];

        if (shape.type === 'circle') {
          const dx = x - shape.x;
          const dy = y - shape.y;
          if (dx * dx + dy * dy <= shape.radius * shape.radius) {
            hitId = shape.id;
            selectedShapeStart.value = { x: shape.x, y: shape.y };
            break;
          }
        } else {
          const rotationInRadians = (shape.rotation * Math.PI) / 180 || 0;

          const centerX = shape.x + shape.width / 2;
          const centerY = shape.y + shape.height / 2;

          const translatedX = x - centerX;
          const translatedY = y - centerY;

          const cosA = Math.cos(-rotationInRadians);
          const sinA = Math.sin(-rotationInRadians);

          const rotatedX = translatedX * cosA - translatedY * sinA + centerX;
          const rotatedY = translatedX * sinA + translatedY * cosA + centerY;

          if (
            rotatedX >= shape.x &&
            rotatedX <= shape.x + shape.width &&
            rotatedY >= shape.y &&
            rotatedY <= shape.y + shape.height
          ) {
            hitId = shape.id;
            selectedShapeStart.value = { x: shape.x, y: shape.y };
            break;
          }
        }
      }

      selectedShapeId.value = hitId;
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
          break;
        }
      }

      shapes.value = [...currentShapes];

      notifyChange(shapes);
    })
    .onEnd(() => {
      'worklet';
      // Don't clear selection on gesture end - let the context menu handle it
      // selectedShapeId.value = null;
    });

  const rotateSelectionGesture = Gesture.Rotation()
    .enabled(currentTool === 'selection')
    .onUpdate((event) => {
      'worklet';
      if (!selectedShapeId.value) return;

      const currentShapes = shapes.value;

      for (let i = 0; i < currentShapes.length; i++) {
        if (currentShapes[i].id === selectedShapeId.value) {
          currentShapes[i].rotation += event.rotation;
          break;
        }
      }

      shapes.value = [...currentShapes];

      notifyChange(shapes);
    })
    .onEnd(() => {
      'worklet';
      // Don't clear selection on gesture end - let the context menu handle it
      // selectedShapeId.value = null;
    });

  return {
    panSelectionGesture,
    rotateSelectionGesture,
  };
};

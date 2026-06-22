import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';
import { runOnJS } from 'react-native-reanimated';

export const createShapeGestures = ({
  currentTool,
  scale,
  translateX,
  translateY,
  shapeToolType,
  selectedShapeId,
  selectedShapeStart,
  selectedShapeBounds,
  selectedShapeRotation,
  activeStrokeColour,
  activeStrokeThickness,
  shapes,
  onSelectedShapeChange,
  addShape,
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

  const tapPlaceShapeGesture = Gesture.Tap()
    .enabled(currentTool === 'shape')
    .onStart((event) => {
      'worklet';
      // MW - Get canvas coordinates from the tap event and add a new shape at that point.
      const { x, y } = getCanvasPoint(event.x, event.y);

      if (x < 0 || y < 0) {
        // MW - Ignore taps that are outside the canvas bounds (can happen if the user taps the toolbar or status bar).
        return;
      }

      const currentShapes = shapes.value;

      for (let i = currentShapes.length - 1; i >= 0; i--) {
        const shape = currentShapes[i];
        if (hitTestShape(shape, x, y)) {
          selectedShapeId.value = shape.id;
          selectedShapeStart.value = { x: shape.x, y: shape.y };
          selectedShapeBounds.value = getShapeBounds(shape);
          selectedShapeRotation.value =
            shape.type === 'circle' ? 0 : shape.rotation || 0;
          notifyChange(selectedShapeId);
          notifyChange(selectedShapeBounds);
          notifyChange(selectedShapeRotation);
          if (onSelectedShapeChange) {
            runOnJS(onSelectedShapeChange)(shape.id);
          }
          return;
        }
      }

      // MW - Scale shape dimensions from the brush-size slider (range 2–40).
      // Multiplying by 5 maps the slider to a 10–200 px size range on the canvas.
      const size = activeStrokeThickness.value * 5;
      const colour = activeStrokeColour.value;
      const ts = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      let newShape = null;

      switch (shapeToolType) {
        case 'rect':
          newShape = {
            id: `rect-${ts}`,
            type: 'rect',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'circle':
          newShape = {
            id: `circle-${ts}`,
            type: 'circle',
            x,
            y,
            radius: size / 2,
            colour,
            rotation: 0,
          };
          break;
        case 'line':
          // Line extends horizontally; height:0 keeps it flat until the user rotates it.
          newShape = {
            id: `line-${ts}`,
            type: 'line',
            x,
            y,
            width: size,
            height: 0,
            colour,
            rotation: 0,
          };
          break;
        case 'triangle':
          newShape = {
            id: `triangle-${ts}`,
            type: 'triangle',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'arrow':
          newShape = {
            id: `arrow-${ts}`,
            type: 'arrow',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'star':
          newShape = {
            id: `star-${ts}`,
            type: 'star',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'diamond':
          newShape = {
            id: `diamond-${ts}`,
            type: 'diamond',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'cross':
          newShape = {
            id: `cross-${ts}`,
            type: 'cross',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'check':
          newShape = {
            id: `check-${ts}`,
            type: 'check',
            x,
            y,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
      }

      if (!newShape) {
        return;
      }

      shapes.value = [...shapes.value, newShape];

      selectedShapeId.value = newShape.id;
      selectedShapeStart.value = { x: newShape.x, y: newShape.y };
      selectedShapeBounds.value = getShapeBounds(newShape);

      selectedShapeRotation.value = newShape.rotation || 0;
      notifyChange(selectedShapeId);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);

      if (onSelectedShapeChange) {
        runOnJS(onSelectedShapeChange)(newShape.id);
      }

      if (addShape) {
        runOnJS(addShape)(newShape);
      }
    });

  return {
    tapPlaceShapeGesture,
  };
};

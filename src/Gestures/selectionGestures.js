import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';
import { makeMutable, runOnJS } from 'react-native-reanimated';

export const createSelectionGestures = ({
  currentTool,
  scale,
  translateX,
  translateY,
  selectedShapeId,
  selectedShapeStart,
  selectedShapeBounds,
  selectedShapeRotation,
  pinchStartDimensions,
  shapes,
  layerOrder,
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
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    // MW - Lines can be drawn in any direction (signed width/height), so
    // normalise to a min/max box before hit-testing.
    const minX = Math.min(shape.x, shape.x + w);
    const maxX = Math.max(shape.x, shape.x + w);
    const minY = Math.min(shape.y, shape.y + h);
    const maxY = Math.max(shape.y, shape.y + h);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const rotationInRadians = ((shape.rotation ?? 0) * Math.PI) / 180;
    const tx = px - centerX;
    const ty = py - centerY;
    const cosA = Math.cos(-rotationInRadians);
    const sinA = Math.sin(-rotationInRadians);
    const rx = tx * cosA - ty * sinA + centerX;
    const ry = tx * sinA + ty * cosA + centerY;
    return (
      rx >= minX - padding &&
      rx <= maxX + padding &&
      ry >= minY - padding &&
      ry <= maxY + padding
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

  const renderRankOf = (shape, arrayIndex) => {
    'worklet';
    const layerId = shape.layer ?? (shape.type === 'text' ? 'text' : 'shapes');
    const order = layerOrder ? layerOrder.value : null;
    let layerIndex = 0;
    if (order) {
      const found = order.indexOf(layerId);
      layerIndex = found === -1 ? order.length : found;
    }
    return layerIndex * 1000000 + arrayIndex;
  };

  // MW - Find the top-most rendered shape under a canvas-space point.
  const pickTopShape = (currentShapes, px, py) => {
    'worklet';
    let best = null;
    let bestRank = -1;
    for (let i = 0; i < currentShapes.length; i++) {
      const shape = currentShapes[i];
      if (!hitTestShape(shape, px, py)) continue;
      const rank = renderRankOf(shape, i);
      if (rank > bestRank) {
        bestRank = rank;
        best = shape;
      }
    }
    return best;
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
    if (shape.type === 'line') {
      const w = shape.width ?? 0;
      const h = shape.height ?? 0;
      return {
        x: Math.min(shape.x, shape.x + w),
        y: Math.min(shape.y, shape.y + h),
        width: Math.abs(w),
        height: Math.abs(h),
      };
    }
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  };

  // MW - Rotation start angle (degrees) captured at gesture begin so updates
  // apply the cumulative gesture delta to a fixed baseline.
  const rotationStart = makeMutable(0);

  const pinchResizeGesture = Gesture.Pinch()
    .onBegin(() => {
      'worklet';
      if (!selectedShapeId.value) return;

      const currentShapes = shapes.value;

      for (let i = 0; i < currentShapes.length; i++) {
        if (currentShapes[i].id === selectedShapeId.value) {
          const shape = currentShapes[i];
          // MW - Snapshot dimensions at gesture start so onUpdate can scale
          // from a fixed baseline (event.scale is cumulative from 1.0).
          pinchStartDimensions.value = {
            width: shape.width ?? 0,
            height: shape.height ?? 0,
            radius: shape.radius ?? 0,
          };
          if (onBeforeShapeMutation) {
            runOnJS(onBeforeShapeMutation)(
              currentShapes.map((s) => ({ ...s }))
            );
          }
          break;
        }
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (!selectedShapeId.value) return;

      const currentShapes = shapes.value;

      for (let i = 0; i < currentShapes.length; i++) {
        if (currentShapes[i].id === selectedShapeId.value) {
          const shape = currentShapes[i];

          if (shape.type === 'circle') {
            // MW - Circles use radius, not width/height.
            const newRadius = pinchStartDimensions.value.radius * event.scale;
            if (newRadius > 0) {
              shape.radius = newRadius;
              selectedShapeBounds.value = getShapeBounds(shape);
            }
          } else {
            // MW - Use the snapshotted start dimensions so scale is applied
            // relative to the gesture origin, not the current (already-scaled)
            // dimensions — otherwise each frame compounds the previous one.
            const newWidth = pinchStartDimensions.value.width * event.scale;
            const newHeight = pinchStartDimensions.value.height * event.scale;

            // MW - Prevent resizing to zero or negative dimensions.
            if (newWidth > 0 && newHeight > 0) {
              shape.width = newWidth;
              shape.height = newHeight;
              selectedShapeBounds.value = getShapeBounds(shape);
            }
          }
          break;
        }
      }

      shapes.value = [...currentShapes];

      notifyChange(shapes);
      notifyChange(selectedShapeBounds);
    });
  const tapSelectionGesture = Gesture.Tap()
    .enabled(currentTool === 'selection' || currentTool === 'move')
    .onStart((event) => {
      'worklet';

      const { x, y } = getCanvasPoint(event.x, event.y);
      const currentShapes = shapes.value;
      const hitShape = pickTopShape(currentShapes, x, y);
      const hitId = hitShape ? hitShape.id : null;

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

      const hitShape = pickTopShape(currentShapes, x, y);
      if (hitShape) {
        hitId = hitShape.id;
        selectedShapeStart.value = { x: hitShape.x, y: hitShape.y };
        selectedShapeBounds.value = getShapeBounds(hitShape);
        selectedShapeRotation.value =
          hitShape.type === 'circle' ? 0 : hitShape.rotation || 0;
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
      if (!selectedShapeId.value) return;
      const cs = shapes.value;
      for (let i = 0; i < cs.length; i++) {
        if (cs[i].id === selectedShapeId.value) {
          rotationStart.value = cs[i].rotation ?? 0;
          break;
        }
      }
      if (onBeforeShapeMutation) {
        runOnJS(onBeforeShapeMutation)(cs.map((s) => ({ ...s })));
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (!selectedShapeId.value) return;

      // MW - event.rotation is the cumulative angle in RADIANS since the
      // gesture began. Convert to degrees and add to the captured start angle
      // so rotation tracks the fingers 1:1 (the old code added radians into a
      // degrees field and compounded the running total every frame).
      const nextRotation =
        rotationStart.value + (event.rotation * 180) / Math.PI;

      const currentShapes = shapes.value;

      for (let i = 0; i < currentShapes.length; i++) {
        if (currentShapes[i].id === selectedShapeId.value) {
          currentShapes[i].rotation = nextRotation;
          // MW - Keep the outline rotation in sync with the shape.
          selectedShapeRotation.value = nextRotation;
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
    pinchResizeGesture,
  };
};

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
  pinchStartDimensions,
  draggingShape,
  dragLastTransX,
  dragLastTransY,
  edgePanX,
  edgePanY,
  shapes,
  layerOrder,
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

  // MW - Edge auto-pan velocity from the finger's screen position.
  const EDGE_ZONE = 56;
  const EDGE_MAX_SPEED = 14;
  const updateEdgePan = (ax, ay) => {
    'worklet';
    let evx = 0;
    let evy = 0;
    if (ax < EDGE_ZONE) {
      evx = Math.min((EDGE_ZONE - ax) / EDGE_ZONE, 1) * EDGE_MAX_SPEED;
    } else if (ax > windowWidth - EDGE_ZONE) {
      evx =
        -Math.min((ax - (windowWidth - EDGE_ZONE)) / EDGE_ZONE, 1) *
        EDGE_MAX_SPEED;
    }
    if (ay < EDGE_ZONE) {
      evy = Math.min((EDGE_ZONE - ay) / EDGE_ZONE, 1) * EDGE_MAX_SPEED;
    } else if (ay > windowHeight - EDGE_ZONE) {
      evy =
        -Math.min((ay - (windowHeight - EDGE_ZONE)) / EDGE_ZONE, 1) *
        EDGE_MAX_SPEED;
    }
    edgePanX.value = evx;
    edgePanY.value = evy;
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
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    // MW - Lines can be drawn in any direction (signed width/height), so
    // normalise to a min/max box before hit-testing.
    const minX = Math.min(shape.x, shape.x + w);
    const maxX = Math.max(shape.x, shape.x + w);
    const minY = Math.min(shape.y, shape.y + h);
    const maxY = Math.max(shape.y, shape.y + h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
    const cosA = Math.cos(-rot);
    const sinA = Math.sin(-rot);
    const tx = px - cx;
    const ty = py - cy;
    const rx = tx * cosA - ty * sinA + cx;
    const ry = tx * sinA + ty * cosA + cy;
    return (
      rx >= minX - padding &&
      rx <= maxX + padding &&
      ry >= minY - padding &&
      ry <= maxY + padding
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

  const isPanningViewport = makeMutable(false);
  const isPinchActive = makeMutable(false);

  const prevPointerX = makeMutable(0);
  const prevPointerY = makeMutable(0);
  // MW - Rotation start angle (degrees) captured at gesture begin.
  const rotationStart = makeMutable(0);
  // MW - Incremental pinch trackers so zoom follows the focal point smoothly
  // each frame instead of snapping from a fixed baseline.
  const prevPinchScale = makeMutable(1);
  const prevFocalX = makeMutable(0);
  const prevFocalY = makeMutable(0);

  const controlPanGesture = Gesture.Pan()
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

      if (hitId) {
        // Touching a shape — set up shape drag.
        isPanningViewport.value = false;
        draggingShape.value = true;
      } else if (selectedShapeId.value == null) {
        draggingShape.value = false;
        isPanningViewport.value = true;
        prevPointerX.value = event.x;
        prevPointerY.value = event.y;
      } else {
        isPanningViewport.value = false;
        draggingShape.value = false;
        selectedShapeBounds.value = { x: 0, y: 0, width: 0, height: 0 };
        selectedShapeRotation.value = 0;
      }

      edgePanX.value = 0;
      edgePanY.value = 0;

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
        dragLastTransX.value = event.translationX;
        dragLastTransY.value = event.translationY;
        updateEdgePan(event.absoluteX, event.absoluteY);
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
        const dx = event.x - prevPointerX.value;
        const dy = event.y - prevPointerY.value;
        prevPointerX.value = event.x;
        prevPointerY.value = event.y;
        if (!isPinchActive.value) {
          const tx = translateX.value + dx;
          const ty = translateY.value + dy;
          const clamped = clampTranslations(tx, ty, scale.value);
          translateX.value = clamped.x;
          translateY.value = clamped.y;
        }
      }
    })
    .onEnd(() => {
      'worklet';
      if (isPanningViewport.value) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
      isPanningViewport.value = false;
      draggingShape.value = false;
      edgePanX.value = 0;
      edgePanY.value = 0;
    });

  const controlPinchGesture = Gesture.Pinch()
    .onStart((event) => {
      'worklet';
      if (selectedShapeId.value != null) {
        // MW - Snapshot dimensions at gesture start so onUpdate can scale from
        // a fixed baseline (event.scale is cumulative from 1.0).
        const currentShapes = shapes.value;
        for (let i = 0; i < currentShapes.length; i++) {
          if (currentShapes[i].id === selectedShapeId.value) {
            const shape = currentShapes[i];
            pinchStartDimensions.value = {
              width: shape.width ?? 0,
              height: shape.height ?? 0,
              radius: shape.radius ?? 0,
              fontSize: shape.fontSize ?? 0,
            };
            if (onBeforeShapeMutation) {
              runOnJS(onBeforeShapeMutation)(
                currentShapes.map((s) => ({ ...s }))
              );
            }
            return;
          }
        }
        return;
      }
      isPinchActive.value = true;
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      prevPinchScale.value = 1;
      prevFocalX.value = event.focalX;
      prevFocalY.value = event.focalY;
    })
    .onUpdate((event) => {
      'worklet';
      if (selectedShapeId.value != null) {
        // MW - Resize the selected shape; do not zoom/pan the viewport.
        const currentShapes = shapes.value;
        for (let i = 0; i < currentShapes.length; i++) {
          if (currentShapes[i].id === selectedShapeId.value) {
            const shape = currentShapes[i];
            if (shape.type === 'circle') {
              const newRadius = pinchStartDimensions.value.radius * event.scale;
              if (newRadius > 0) {
                shape.radius = newRadius;
                selectedShapeBounds.value = getShapeBounds(shape);
              }
            } else if (shape.type === 'text') {
              // MW - Text is sized by fontSize; scale it (and the cached glyph
              // width/height, linear in font size) from the snapshotted
              // baseline so the glyphs scale live with the selection box.
              const newFontSize =
                pinchStartDimensions.value.fontSize * event.scale;
              if (newFontSize > 0) {
                shape.fontSize = newFontSize;
                shape.width = pinchStartDimensions.value.width * event.scale;
                shape.height = newFontSize;
                selectedShapeBounds.value = getShapeBounds(shape);
              }
            } else {
              const newWidth = pinchStartDimensions.value.width * event.scale;
              const newHeight = pinchStartDimensions.value.height * event.scale;
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
        return;
      }
      if (event.numberOfPointers != null && event.numberOfPointers < 2) {
        return;
      }
      // MW - Incremental zoom: follow the focal point's movement this frame
      // (focalDX/DY) then scale around the current focal point. Working from
      // the live translate/scale each frame keeps the gesture smooth and
      // prevents the canvas from jumping when the focal point drifts.
      const scaleDelta = event.scale / prevPinchScale.value;
      const focalDX = event.focalX - prevFocalX.value;
      const focalDY = event.focalY - prevFocalY.value;

      let tx = translateX.value + focalDX;
      let ty = translateY.value + focalDY;

      let nextScale = scale.value * scaleDelta;
      nextScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
      const actualScaleDelta = nextScale / scale.value;

      tx = event.focalX - (event.focalX - tx) * actualScaleDelta;
      ty = event.focalY - (event.focalY - ty) * actualScaleDelta;

      const clamped = clampTranslations(tx, ty, nextScale);
      scale.value = nextScale;
      translateX.value = clamped.x;
      translateY.value = clamped.y;

      prevPinchScale.value = event.scale;
      prevFocalX.value = event.focalX;
      prevFocalY.value = event.focalY;
    })
    .onEnd(() => {
      'worklet';
      if (selectedShapeId.value != null) return;
      isPinchActive.value = false;
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const controlRotateGesture = Gesture.Rotation()
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
      // gesture began. Convert to degrees and add to the start rotation so the
      // shape tracks the fingers 1:1 instead of compounding every frame (the
      // old code added radians into a degrees field and re-added the running
      // total each update, causing runaway over-rotation).
      const nextRotation =
        rotationStart.value + (event.rotation * 180) / Math.PI;
      const currentShapes = shapes.value;
      for (let i = 0; i < currentShapes.length; i++) {
        if (currentShapes[i].id === selectedShapeId.value) {
          currentShapes[i].rotation = nextRotation;
          selectedShapeRotation.value = nextRotation;
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

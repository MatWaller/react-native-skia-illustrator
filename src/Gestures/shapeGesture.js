import { Gesture } from 'react-native-gesture-handler';
import { notifyChange } from '@shopify/react-native-skia';
import { makeMutable, runOnJS } from 'react-native-reanimated';

export const createShapeGestures = ({
  currentTool,
  scale,
  translateX,
  translateY,
  savedTranslateX,
  savedTranslateY,
  windowWidth,
  windowHeight,
  canvasWidth,
  canvasHeight,
  shapeToolType,
  selectedShapeId,
  selectedShapeStart,
  selectedShapeBounds,
  selectedShapeRotation,
  activeStrokeColour,
  activeStrokeThickness,
  activeLineThickness,
  shapes,
  onSelectedShapeChange,
  addShape,
  beginShapeCreation,
  finalizeShapeCreation,
  lineAnchor,
  pendingLinePreview,
  activeIconAspect,
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

  // MW - Clamp the viewport so a pan in shape mode (when no shape/icon is
  // selected in the toolbar) keeps the canvas within view, mirroring the
  // control tool's pan bounds.
  const PAN_PADDING = 150;
  const clampTranslations = (x, y, s) => {
    'worklet';
    return {
      x: Math.min(
        Math.max(x, PAN_PADDING - (canvasWidth ?? 0) * s),
        (windowWidth ?? 0) - PAN_PADDING
      ),
      y: Math.min(
        Math.max(y, PAN_PADDING - (canvasHeight ?? 0) * s),
        (windowHeight ?? 0) - PAN_PADDING
      ),
    };
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
      // MW - A thin rectangle (length x thickness) hugging the stroke rather
      // than the diagonal's axis-aligned box, which balloons out square-ish
      // for angled lines. Rotate the outline by getLineAngleDeg to match.
      const w = shape.width ?? 0;
      const h = shape.height ?? 0;
      const length = Math.hypot(w, h);
      const thickness = shape.thickness ?? 8;
      return {
        x: shape.x + w / 2 - length / 2,
        y: shape.y + h / 2 - thickness / 2,
        width: length,
        height: thickness,
      };
    }
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  };

  // MW - Effective visual angle of a line: its drawn vector direction plus
  // any rotation applied on top via the two-finger rotate gesture.
  const getLineAngleDeg = (shape) => {
    'worklet';
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    return (Math.atan2(h, w) * 180) / Math.PI + (shape.rotation ?? 0);
  };

  const canPlaceShape = currentTool === 'shape' || currentTool === 'icon';

  const tapPlaceShapeGesture = Gesture.Tap()
    .enabled(canPlaceShape)
    .onStart((event) => {
      'worklet';
      // MW - Get canvas coordinates from the tap event and add a new shape at that point.
      const { x, y } = getCanvasPoint(event.x, event.y);

      if (x < 0 || y < 0) {
        // MW - Ignore taps that are outside the canvas bounds (can happen if the user taps the toolbar or status bar).
        return;
      }

      const currentShapes = shapes.value;

      // MW - Two-tap line placement: if an anchor was dropped on a previous
      // tap, this tap is the line's end point. Build the line from the anchor
      // to here (signed width/height preserves the drawn direction).
      if (shapeToolType === 'line' && lineAnchor && lineAnchor.value != null) {
        const a = lineAnchor.value;
        const ts = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const lineShape = {
          id: `line-${ts}`,
          type: 'line',
          x: a.x,
          y: a.y,
          width: x - a.x,
          height: y - a.y,
          thickness: activeLineThickness.value,
          colour: activeStrokeColour.value,
          rotation: 0,
        };
        lineAnchor.value = null;
        if (pendingLinePreview) {
          pendingLinePreview.value = { active: false, x: 0, y: 0 };
          notifyChange(pendingLinePreview);
        }
        notifyChange(lineAnchor);

        shapes.value = [...currentShapes, lineShape];
        notifyChange(shapes);
        selectedShapeId.value = lineShape.id;
        selectedShapeStart.value = { x: lineShape.x, y: lineShape.y };
        selectedShapeBounds.value = getShapeBounds(lineShape);
        selectedShapeRotation.value = getLineAngleDeg(lineShape);
        notifyChange(selectedShapeId);
        notifyChange(selectedShapeBounds);
        notifyChange(selectedShapeRotation);
        if (onSelectedShapeChange) {
          runOnJS(onSelectedShapeChange)(lineShape.id);
        }
        if (addShape) {
          runOnJS(addShape)(lineShape);
        }
        return;
      }

      // MW - Line tool, no anchor yet: drop the first point and wait for the
      // second tap to complete the line (a drag also works via the pan
      // gesture). A preview marker is shown at the anchor.
      if (shapeToolType === 'line') {
        if (lineAnchor) {
          lineAnchor.value = { x, y };
          notifyChange(lineAnchor);
        }
        if (pendingLinePreview) {
          pendingLinePreview.value = { active: true, x, y };
          notifyChange(pendingLinePreview);
        }
        return;
      }

      // MW - Scale shape dimensions from the brush-size slider (range 2–40).
      // Multiplying by 5 maps the slider to a 10–200 px size range on the canvas.
      const size = activeStrokeThickness.value * 5;
      const colour = activeStrokeColour.value;
      const ts = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // MW - Offset so the shape is centred on the tap point rather than
      // having its top-left corner there. Circles are already centred (cx/cy).
      const ox = x - size / 2;
      const oy = y - size / 2;

      let newShape = null;

      switch (shapeToolType) {
        case 'rect':
          newShape = {
            id: `rect-${ts}`,
            type: 'rect',
            x: ox,
            y: oy,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'circle':
          // Circle x/y is its centre point, so no offset needed.
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
            x: ox,
            y,
            width: size,
            height: 0,
            thickness: activeLineThickness.value,
            colour,
            rotation: 0,
          };
          break;
        case 'triangle':
          newShape = {
            id: `triangle-${ts}`,
            type: 'triangle',
            x: ox,
            y: oy,
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
            x: ox,
            y: oy,
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
            x: ox,
            y: oy,
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
            x: ox,
            y: oy,
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
            x: ox,
            y: oy,
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
            x: ox,
            y: oy,
            width: size,
            height: size,
            colour,
            rotation: 0,
          };
          break;
        case 'icon': {
          // MW - iconPath / iconViewBox are merged in addShape on the JS thread
          // (via activeIconDataRef) so we don't capture large SVG strings here.
          // Apply the cached aspect ratio immediately so the icon is placed
          // undistorted (addShape later reconciles against the real viewBox).
          const aspect =
            activeIconAspect && activeIconAspect.value > 0
              ? activeIconAspect.value
              : 1;
          const iconH = size * aspect;
          newShape = {
            id: `icon-${ts}`,
            type: 'icon',
            x: ox,
            y: y - iconH / 2,
            width: size,
            height: iconH,
            colour,
            rotation: 0,
            iconName: '',
            iconPath: '',
            iconViewBox: { width: 512, height: 512 },
          };
          break;
        }
      }

      if (!newShape) {
        return;
      }

      shapes.value = [...shapes.value, newShape];
      notifyChange(shapes);

      selectedShapeId.value = newShape.id;
      selectedShapeStart.value = { x: newShape.x, y: newShape.y };
      selectedShapeBounds.value = getShapeBounds(newShape);

      selectedShapeRotation.value =
        newShape.type === 'line'
          ? getLineAngleDeg(newShape)
          : newShape.rotation || 0;
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

  // MW - Drag-to-place: press on the canvas and drag to size a new shape in
  // real time (anchored at the press point). Existing-shape selection and
  // movement are handled by control mode.
  const createStart = makeMutable({ x: 0, y: 0 });
  const createMode = makeMutable('none'); // 'none' | 'create' | 'pan'
  const creatingShapeId = makeMutable(null);

  const dragPlaceShapeGesture = Gesture.Pan()
    .enabled(canPlaceShape)
    .minDistance(6)
    .maxPointers(1)
    .onBegin((event) => {
      'worklet';
      const { x, y } = getCanvasPoint(event.x, event.y);
      if (!shapeToolType) {
        // MW - No shape/icon picked in the toolbar: a drag on empty canvas pans
        // the viewport instead of drag-placing a bounding box.
        createMode.value = 'pan';
        creatingShapeId.value = null;
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      } else {
        // Empty canvas — prepare to create on drag (deferred to onStart so a
        // plain tap doesn't create a zero-size shape).
        createMode.value = 'create';
        createStart.value = { x, y };
        creatingShapeId.value = null;
      }
    })
    .onStart(() => {
      'worklet';
      if (createMode.value === 'pan') return;
      if (createMode.value !== 'create') return;

      const a = createStart.value;
      if (a.x < 0 || a.y < 0) {
        createMode.value = 'none';
        return;
      }

      // MW - Line tool: a drag overrides any pending two-tap anchor.
      if (lineAnchor) {
        lineAnchor.value = null;
        notifyChange(lineAnchor);
      }
      if (pendingLinePreview) {
        pendingLinePreview.value = { active: false, x: 0, y: 0 };
        notifyChange(pendingLinePreview);
      }

      const colour = activeStrokeColour.value;
      const ts = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const id = `${shapeToolType}-${ts}`;

      let newShape;
      if (shapeToolType === 'circle') {
        newShape = {
          id,
          type: 'circle',
          x: a.x,
          y: a.y,
          radius: 1,
          colour,
          rotation: 0,
        };
      } else if (shapeToolType === 'line') {
        newShape = {
          id,
          type: 'line',
          x: a.x,
          y: a.y,
          width: 0,
          height: 0,
          thickness: activeLineThickness.value,
          colour,
          rotation: 0,
        };
      } else if (shapeToolType === 'icon') {
        newShape = {
          id,
          type: 'icon',
          x: a.x,
          y: a.y,
          width: 1,
          height: 1,
          colour,
          rotation: 0,
          iconName: '',
          iconPath: '',
          iconViewBox: { width: 512, height: 512 },
        };
      } else {
        newShape = {
          id,
          type: shapeToolType,
          x: a.x,
          y: a.y,
          width: 1,
          height: 1,
          colour,
          rotation: 0,
        };
      }

      creatingShapeId.value = id;
      shapes.value = [...shapes.value, newShape];
      notifyChange(shapes);
      selectedShapeId.value = id;
      selectedShapeStart.value = { x: newShape.x, y: newShape.y };
      selectedShapeRotation.value = 0;
      selectedShapeBounds.value = getShapeBounds(newShape);
      notifyChange(selectedShapeId);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);
      if (onSelectedShapeChange) {
        runOnJS(onSelectedShapeChange)(id);
      }
      // MW - Mount the shape (and snapshot history) on the JS thread. Geometry
      // keeps updating live on the UI thread below.
      if (beginShapeCreation) {
        runOnJS(beginShapeCreation)(newShape);
      }
    })
    .onUpdate((event) => {
      'worklet';
      if (createMode.value === 'pan') {
        // MW - Viewport pan (no shape/icon selected in the toolbar).
        const tx = savedTranslateX.value + event.translationX;
        const ty = savedTranslateY.value + event.translationY;
        const clamped = clampTranslations(tx, ty, scale.value || 1);
        translateX.value = clamped.x;
        translateY.value = clamped.y;
        return;
      }
      if (createMode.value !== 'create' || creatingShapeId.value == null)
        return;

      const a = createStart.value;
      const b = getCanvasPoint(event.x, event.y);
      const cs = shapes.value;
      for (let i = 0; i < cs.length; i++) {
        if (cs[i].id !== creatingShapeId.value) continue;
        const s = cs[i];
        if (s.type === 'circle') {
          const minX = Math.min(a.x, b.x);
          const minY = Math.min(a.y, b.y);
          const w = Math.abs(b.x - a.x);
          const h = Math.abs(b.y - a.y);
          s.x = minX + w / 2;
          s.y = minY + h / 2;
          s.radius = Math.max(w, h) / 2;
        } else if (s.type === 'line') {
          // Signed extent keeps the line pointing from anchor to finger.
          s.x = a.x;
          s.y = a.y;
          s.width = b.x - a.x;
          s.height = b.y - a.y;
          selectedShapeRotation.value = getLineAngleDeg(s);
          notifyChange(selectedShapeRotation);
        } else if (s.type === 'icon') {
          // MW - Size the icon to the dragged box while preserving its aspect
          // ratio (height / width). The anchor corner stays put and the icon
          // grows toward the finger.
          const aspect =
            activeIconAspect && activeIconAspect.value > 0
              ? activeIconAspect.value
              : 1;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          let w = Math.abs(dx);
          let h = Math.abs(dy);
          // Fit to aspect: expand the smaller dimension so the icon fills the
          // drag without distortion.
          if (w * aspect >= h) {
            h = w * aspect;
          } else {
            w = h / aspect;
          }
          s.width = w;
          s.height = h;
          s.x = dx < 0 ? a.x - w : a.x;
          s.y = dy < 0 ? a.y - h : a.y;
        } else {
          s.x = Math.min(a.x, b.x);
          s.y = Math.min(a.y, b.y);
          s.width = Math.abs(b.x - a.x);
          s.height = Math.abs(b.y - a.y);
        }
        selectedShapeBounds.value = getShapeBounds(s);
        break;
      }
      shapes.value = [...cs];
      notifyChange(shapes);
      notifyChange(selectedShapeBounds);
    })
    .onEnd(() => {
      'worklet';
      if (createMode.value === 'pan') {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        createMode.value = 'none';
        creatingShapeId.value = null;
        return;
      }
      if (createMode.value === 'create' && creatingShapeId.value != null) {
        const id = creatingShapeId.value;
        const cs = shapes.value;
        for (let i = 0; i < cs.length; i++) {
          if (cs[i].id !== id) continue;
          const s = cs[i];
          // MW - Guard against zero/near-zero sizes from a tiny drag.
          if (s.type === 'circle') {
            if ((s.radius ?? 0) < 2) s.radius = 2;
          } else if (s.type === 'line') {
            if (s.width === 0 && s.height === 0) s.width = 1;
          } else if (s.type === 'icon') {
            // MW - Enforce a minimum size while keeping the aspect ratio intact.
            const aspect =
              activeIconAspect && activeIconAspect.value > 0
                ? activeIconAspect.value
                : 1;
            if ((s.width ?? 0) < 8) {
              s.width = 8;
              s.height = 8 * aspect;
            }
          } else {
            if (Math.abs(s.width ?? 0) < 4) s.width = 4;
            if (Math.abs(s.height ?? 0) < 4) s.height = 4;
          }
          selectedShapeBounds.value = getShapeBounds(s);
          break;
        }
        shapes.value = [...cs];
        notifyChange(shapes);
        notifyChange(selectedShapeBounds);
        if (finalizeShapeCreation) {
          runOnJS(finalizeShapeCreation)(id);
        }
      }
      createMode.value = 'none';
      creatingShapeId.value = null;
    });

  return {
    tapPlaceShapeGesture,
    dragPlaceShapeGesture,
  };
};

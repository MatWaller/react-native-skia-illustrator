// Core Imports
import React, { useMemo, useEffect, useLayoutEffect, useState } from 'react';

// React Native Imports
import {
  StyleSheet,
  View,
  useWindowDimensions,
  Keyboard,
  Alert,
} from 'react-native';

// Gesture Handler Imports
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

// Gesture Imports
import { createSelectionGestures } from '../Gestures/selectionGestures';
import { createPaintGestures } from '../Gestures/paintGestures';
import { createTextGestures } from '../Gestures/textGestures';
import { createShapeGestures } from '../Gestures/shapeGesture';
import { createControlGestures } from '../Gestures/controlGestures';

// Reanimated Imports
import {
  useSharedValue,
  useDerivedValue,
  useFrameCallback,
} from 'react-native-reanimated';

// Skia Imports
import {
  Skia,
  Image,
  Canvas,
  Group,
  Path,
  Paint,
  Circle,
  Box,
  BoxShadow,
  rect,
  notifyChange,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
  BlendMode,
} from '@shopify/react-native-skia';

import { ShapeNode, getSharedTypeface, measureText } from './ShapeNode';
import GridOverlay from './GridOverlay';
import RulerOverlay from './RulerOverlay';
import LoadingOverlay from './LoadingOverlay';
import SelectionOutline from './SelectionOutline';
import TextEditingModal from './TextEditingModal';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useTextEditing } from '../hooks/useTextEditing';
import {
  getShapeLayer,
  getShapeAABB,
  buildFlattenedPath,
  PAPER_SIZE,
} from '../utils/shapeUtils';

// MW - Defensively release a native-backed Skia object (Path, Image, Surface,
// etc.). Skia host objects hold native memory that is NOT tracked by the JS
// garbage collector, so leaving them un-disposed leaks native heap across
// mount/unmount cycles — which matters when the host app renders several
// SkiaIllustrator instances. Guarded so it is a no-op on Skia versions without
// dispose() and safe against double-dispose.
const safeDispose = (obj) => {
  try {
    if (obj && typeof obj.dispose === 'function') {
      obj.dispose();
    }
  } catch {
    // Already disposed / not disposable in this Skia version — ignore.
  }
};

const SkiaIllustrator = React.forwardRef(
  (
    {
      canvasWidth = PAPER_SIZE.width,
      canvasHeight = PAPER_SIZE.height,
      _showGrid = true,
      _showRuler = true,
      imageSource = null,
      initialData = null,
      onToolChange = null,
      onSelectedShapeChange = null,
      textModalProps = null,
      active = true,
    },
    ref
  ) => {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    // MW - Tool States
    const [currentTool, setCurrentTool] = React.useState('control');
    const [currentColour, setCurrentColour] = React.useState('black');

    // MW - Notify the parent whenever the active tool changes so they can update the ui.
    useEffect(() => {
      onToolChange?.(currentTool);
    }, [currentTool, onToolChange]);

    const [resolvedCanvas, setResolvedCanvas] = React.useState({
      width: canvasWidth,
      height: canvasHeight,
    });

    const FIT_MARGIN = 0.9;
    const FIT_MIN_SCALE = 0.2;
    const FIT_MAX_SCALE = 5;
    const getFitScale = React.useCallback(
      (w, h) => {
        if (!w || !h) return 1;
        const fit = Math.min(windowWidth / w, windowHeight / h) * FIT_MARGIN;
        return Math.min(Math.max(fit, FIT_MIN_SCALE), FIT_MAX_SCALE);
      },
      [windowWidth, windowHeight]
    );

    const initialScale = getFitScale(
      resolvedCanvas.width,
      resolvedCanvas.height
    );
    const initialX = (windowWidth - resolvedCanvas.width * initialScale) / 2;
    const initialY = (windowHeight - resolvedCanvas.height * initialScale) / 2;

    // MW - View port states.
    const scale = useSharedValue(initialScale);
    const savedScale = useSharedValue(initialScale);
    const translateX = useSharedValue(initialX);
    const translateY = useSharedValue(initialY);
    const savedTranslateX = useSharedValue(initialX);
    const savedTranslateY = useSharedValue(initialY);

    // MW - Selection states.
    const selectedShapeBounds = useSharedValue(null);
    const selectedShapeRotation = useSharedValue(0);

    const selectedShapeId = useSharedValue(null);
    const selectedShapeStart = useSharedValue({ x: 0, y: 0 });
    // MW - Edge auto-pan: the active drag exposes its live finger delta and an
    // edge velocity so the frame callback can scroll the camera (and carry the
    // shape) when a shape is dragged to the screen edge.
    const draggingShape = useSharedValue(false);
    const dragLastTransX = useSharedValue(0);
    const dragLastTransY = useSharedValue(0);
    const edgePanX = useSharedValue(0);
    const edgePanY = useSharedValue(0);
    const pinchStartDimensions = useSharedValue({
      width: 0,
      height: 0,
      radius: 0,
      fontSize: 0,
    });
    const mountedShapeIds = useSharedValue([]);

    // MW - Paint states.
    const shapes = useSharedValue([]);

    // MW - Two-tap line placement: anchor holds the first tapped point (or
    // null), and pendingLinePreview drives the on-canvas anchor marker.
    const lineAnchor = useSharedValue(null);
    const pendingLinePreview = useSharedValue({ active: false, x: 0, y: 0 });

    // MW - Default content used when placing a new text shape. Consumers can
    // override it through the setText() imperative method.
    const defaultTextContentRef = React.useRef('');

    // MW - `shapes` is initialised to an empty shared value, so seed the React
    // mirror with [] directly. Reading `shapes.value` here would read a
    // Reanimated shared value during render (which logs a warning).
    const [shapeList, setShapeList] = useState([]);
    // MW - null = no shape/icon picked in the toolbar yet. While null, a drag in
    // shape mode pans the viewport instead of drag-placing a shape. setShape()/
    // setIcon() set this to a concrete type, which re-enables drag-to-place.
    const [shapeToolType, setShapeToolType] = useState(null);
    const [canvasReady, setCanvasReady] = useState(false);

    // MW - Drives camera scroll while a shape is dragged to a screen edge. The
    // shape is carried along (kept under the finger) by shifting its drag start
    // by the applied camera delta so the active pan gesture stays consistent.
    const EDGE_PAN_PADDING = 150;
    useFrameCallback(() => {
      'worklet';
      if (!draggingShape.value) return;
      const vx = edgePanX.value;
      const vy = edgePanY.value;
      if (vx === 0 && vy === 0) return;
      const id = selectedShapeId.value;
      if (!id) return;

      const s = scale.value || 1;
      const minTX = EDGE_PAN_PADDING - resolvedCanvas.width * s;
      const maxTX = windowWidth - EDGE_PAN_PADDING;
      const minTY = EDGE_PAN_PADDING - resolvedCanvas.height * s;
      const maxTY = windowHeight - EDGE_PAN_PADDING;

      const nTX = Math.min(Math.max(translateX.value + vx, minTX), maxTX);
      const nTY = Math.min(Math.max(translateY.value + vy, minTY), maxTY);
      const dX = nTX - translateX.value;
      const dY = nTY - translateY.value;
      if (dX === 0 && dY === 0) return;

      translateX.value = nTX;
      translateY.value = nTY;

      const start = selectedShapeStart.value;
      selectedShapeStart.value = { x: start.x - dX / s, y: start.y - dY / s };

      const cs = shapes.value;
      for (let i = 0; i < cs.length; i++) {
        if (cs[i].id !== id) continue;
        const shape = cs[i];
        shape.x = selectedShapeStart.value.x + dragLastTransX.value / s;
        shape.y = selectedShapeStart.value.y + dragLastTransY.value / s;
        let bounds;
        if (shape.type === 'circle') {
          bounds = {
            x: shape.x - shape.radius,
            y: shape.y - shape.radius,
            width: shape.radius * 2,
            height: shape.radius * 2,
          };
        } else if (shape.type === 'text') {
          const h = shape.height ?? shape.fontSize ?? 32;
          bounds = {
            x: shape.x,
            y: shape.y - h,
            width: shape.width ?? 0,
            height: h,
          };
        } else if (shape.type === 'line') {
          const w = shape.width ?? 0;
          const h = shape.height ?? 0;
          bounds = {
            x: Math.min(shape.x, shape.x + w),
            y: Math.min(shape.y, shape.y + h),
            width: Math.abs(w),
            height: Math.abs(h),
          };
        } else {
          bounds = {
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
          };
        }
        selectedShapeBounds.value = bounds;
        break;
      }
      shapes.value = [...cs];
      notifyChange(shapes);
      notifyChange(selectedShapeBounds);
    }, true);

    // MW - Ruler & grid visibility + unit
    const [showGrid, setShowGrid] = useState(_showGrid);
    const [showRuler, setShowRuler] = useState(_showRuler);
    const [rulerUnit, setRulerUnit] = useState('px'); // 'px' | 'cm'

    const activeIconDataRef = React.useRef(null);
    // MW - Live aspect ratio (height / width) of the currently selected icon,
    // mirrored onto the UI thread so the drag-to-size gesture can keep the
    // icon undistorted while it is being drawn (the gesture worklet has no
    // access to the icon's viewBox, which lives in activeIconDataRef on JS).
    const activeIconAspect = useSharedValue(1);

    const [layers, setLayers] = useState([
      { id: 'underlayer', name: 'Under Paint' },
      { id: 'drawing', name: 'Drawing' },
      { id: 'shapes', name: 'Shapes' },
      { id: 'text', name: 'Text' },
    ]);

    // MW - The layer that newly-placed shapes are assigned to. Defaults to the
    // built-in 'shapes' layer; updated when the user adds / activates a layer.
    const [activeLayerId, setActiveLayerId] = useState('shapes');
    const activeLayerIdRef = React.useRef(activeLayerId);
    useEffect(() => {
      activeLayerIdRef.current = activeLayerId;
    }, [activeLayerId]);

    const layersRef = React.useRef(layers);
    useEffect(() => {
      layersRef.current = layers;
    }, [layers]);

    const layerOrder = useSharedValue(layers.map((l) => l.id));
    useEffect(() => {
      layerOrder.value = layers.map((l) => l.id);
    }, [layers, layerOrder]);

    useLayoutEffect(() => {
      mountedShapeIds.value = shapeList.map((s) => s.id);
    }, [shapeList, mountedShapeIds]);

    const [allStrokesPath, setAllStrokesPath] = useState([]);

    // MW - Ref mirror so buildSnapshot (inside useUndoRedo) reads the latest
    // strokes without taking allStrokesPath as a reactive dependency.
    const allStrokesRef = React.useRef(allStrokesPath);
    useEffect(() => {
      allStrokesRef.current = allStrokesPath;
    }, [allStrokesPath]);

    const notifySelectedShapeChange = React.useCallback(
      (shapeId) => {
        onSelectedShapeChange?.(shapeId != null);
      },
      [onSelectedShapeChange]
    );

    const {
      buildSnapshot,
      pushHistory,
      undo,
      redo,
      canUndo,
      canRedo,
      clearHistory,
    } = useUndoRedo({
      shapes,
      allStrokesRef,
      layersRef,
      setShapeList,
      setAllStrokesPath,
      setLayers,
      selectedShapeId,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
    });

    // MW - Stroke Settings
    const activeStrokeThickness = useSharedValue(8);
    const activeStrokePath = useSharedValue(Skia.Path.Make());
    const activeStrokeColour = useSharedValue('black');

    const strokeStartCountRef = React.useRef(0);
    const pendingClearGenRef = React.useRef(null);

    const bumpStrokeStart = React.useCallback(() => {
      strokeStartCountRef.current += 1;
    }, []);

    useLayoutEffect(() => {
      const gen = pendingClearGenRef.current;
      if (gen == null) return;
      pendingClearGenRef.current = null;

      const raf = requestAnimationFrame(() => {
        // MW - A newer stroke has started since this commit; its onStart already
        // installed a fresh active path, so leave it alone.
        if (strokeStartCountRef.current !== gen) return;
        activeStrokePath.value = Skia.Path.Make();
        notifyChange(activeStrokePath);
      });
      return () => cancelAnimationFrame(raf);
    }, [allStrokesPath, activeStrokePath]);

    const activeStrokeRenderColour = useMemo(() => {
      if (
        currentTool === 'highlighter' &&
        currentColour.length === 7 &&
        currentColour.startsWith('#')
      ) {
        return `${currentColour}80`;
      }
      return currentColour;
    }, [currentColour, currentTool]);

    // MW - Font settings
    const activeFontSize = useSharedValue(32);

    // MW - Load the background image if provided.
    // If we are loading a background image the canvas size will be set to the size of the images - this overides the canvasWidth and canvasHeight props.
    const backgroundImage = useMemo(() => {
      if (!imageSource) {
        return null;
      }
      if (typeof imageSource === 'string') {
        try {
          const _pureb64 = imageSource.replace(/^data:image\/\w+;base64,/, '');
          const data = Skia.Data.fromBase64(_pureb64);
          return Skia.Image.MakeImageFromEncoded(data);
        } catch (error) {
          console.error('Error loading image from base64:', error);
          return null;
        }
      }
      return null;
    }, [imageSource]);

    // MW - Dispose the decoded background bitmap when the source changes or the
    // component unmounts. MakeImageFromEncoded allocates a full uncompressed
    // bitmap in native memory (tens of MB for a large image); without this the
    // previous image leaks on every imageSource change and, critically, every
    // SkiaIllustrator instance leaks its bitmap on unmount.
    useEffect(() => {
      return () => safeDispose(backgroundImage);
    }, [backgroundImage]);

    // MW - On unmount, drop undo/redo snapshot references. Do NOT manually
    // dispose Path objects used by declarative <Path> props here: during RN
    // Modal teardown, Skia's render thread may still read those JSI host
    // objects after React begins unmounting the JS tree. Disposing them from
    // JS during teardown can race that read and crash in jsi::Value::getObject.
    useEffect(() => {
      return () => {
        clearHistory();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // MW - Function to add the completed active stroke path to the list of all
    // strokes. The active path is reset on the UI thread when the gesture ends
    // so a delayed JS timer cannot overwrite a fresh in-progress stroke.
    const addPathToAllStrokes = React.useCallback(
      (
        pathSvg,
        colour,
        thickness = 1,
        isEraser = false,
        isHighlighter = false,
        inputInfo = null
      ) => {
        const path =
          typeof pathSvg === 'string'
            ? Skia.Path.MakeFromSVGString(pathSvg)
            : pathSvg;
        if (!path) return;

        // MW - Snapshot before this stroke is committed.
        pushHistory(buildSnapshot(shapes.value));

        // if (pathToShapeEnabled && !isEraser && !isHighlighter) {
        //   const bounds = path.getBounds();
        //   const pad = Math.max((thickness ?? 1) / 2, 1);
        //   const pathBounds = {
        //     x: bounds.x - pad,
        //     y: bounds.y - pad,
        //     width: Math.max(bounds.width + pad * 2, 1),
        //     height: Math.max(bounds.height + pad * 2, 1),
        //   };
        //   const ts = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        //   const pathShape = {
        //     id: `path-${ts}`,
        //     type: 'path',
        //     x: pathBounds.x,
        //     y: pathBounds.y,
        //     width: pathBounds.width,
        //     height: pathBounds.height,
        //     pathSvg: path.toSVGString(),
        //     pathBounds,
        //     colour,
        //     thickness,
        //     rotation: 0,
        //     layer: activeLayerIdRef.current,
        //     inputType: inputInfo?.isStylus ? 'stylus' : 'touch',
        //     pressure: inputInfo
        //       ? {
        //           start: inputInfo.startPressure ?? 1,
        //           end: inputInfo.endPressure ?? 1,
        //         }
        //       : undefined,
        //   };
        //   const next = [...shapes.value, pathShape];
        //   shapes.value = next;
        //   setShapeList(next);
        //   selectedShapeId.value = pathShape.id;
        //   selectedShapeStart.value = { x: pathShape.x, y: pathShape.y };
        //   selectedShapeBounds.value = {
        //     x: pathShape.x,
        //     y: pathShape.y,
        //     width: pathShape.width,
        //     height: pathShape.height,
        //   };
        //   selectedShapeRotation.value = 0;
        //   notifyChange(shapes);
        //   notifyChange(selectedShapeId);
        //   notifyChange(selectedShapeBounds);
        //   notifyChange(selectedShapeRotation);
        //   notifySelectedShapeChange(pathShape.id);

        //   if (resetTimer.current) clearTimeout(resetTimer.current);
        //   resetTimer.current = setTimeout(() => {
        //     activeStrokePath.value = Skia.Path.Make();
        //     notifyChange(activeStrokePath);
        //     resetTimer.current = null;
        //   }, 200);
        //   return;
        // }

        // MW - When erasing: any shape/icon/text whose AABB overlaps the
        // eraser stroke is deleted outright. (Previously overlapping shapes
        // were flattened into the drawing layer and then partially erased;
        // dragging the eraser over a shape now simply removes the whole shape.)
        // The eraser stroke itself is still committed below so it continues to
        // erase freehand paint strokes.
        if (isEraser) {
          const eb = path.getBounds();
          const pad = thickness / 2;
          const ex = eb.x - pad;
          const ey = eb.y - pad;
          const ew = eb.width + thickness;
          const eh = eb.height + thickness;

          const currentShapes = shapes.value;
          const hitIds = [];
          for (const shape of currentShapes) {
            const aabb = getShapeAABB(shape);
            const overlaps =
              aabb.x < ex + ew &&
              aabb.x + aabb.width > ex &&
              aabb.y < ey + eh &&
              aabb.y + aabb.height > ey;
            if (overlaps) hitIds.push(shape.id);
          }

          if (hitIds.length > 0) {
            const next = currentShapes.filter((s) => !hitIds.includes(s.id));
            shapes.value = next;
            setShapeList(next);
            notifyChange(shapes);
            // Clear selection if the selected shape was just erased.
            if (hitIds.includes(selectedShapeId.value)) {
              selectedShapeId.value = null;
              selectedShapeBounds.value = null;
              selectedShapeRotation.value = 0;
              selectedShapeStart.value = { x: 0, y: 0 };
              notifyChange(selectedShapeId);
              notifyChange(selectedShapeBounds);
              notifyChange(selectedShapeRotation);
              notifyChange(selectedShapeStart);
              notifySelectedShapeChange(null);
            }
          }
        }

        if (isHighlighter && colour.length === 7 && colour.startsWith('#')) {
          // MW - if this is a highlighter and no alpha is provided, add 50% alpha to the colour as this should act as a highlighter not a stroke.
          colour = `${colour}80`;
        }

        // Commit the eraser/paint stroke.
        setAllStrokesPath((prev) => [
          ...prev,
          {
            path,
            colour,
            isEraser,
            isHighlighter,
            thickness,
            inputType: inputInfo?.isStylus ? 'stylus' : 'touch',
            pressure: inputInfo
              ? {
                  start: inputInfo.startPressure ?? 1,
                  end: inputInfo.endPressure ?? 1,
                }
              : undefined,
          },
        ]);
        // MW - Mark this exact path for a deferred clear from the active slot.
        // The gesture intentionally leaves it painted in the active slot on
        // release; the useLayoutEffect keyed on allStrokesPath clears it in the
        // same commit the committed copy renders, so there is no flash.
        pendingClearGenRef.current = strokeStartCountRef.current;
      },
      [
        pushHistory,
        buildSnapshot,
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        selectedShapeRotation,
        selectedShapeStart,
        notifySelectedShapeChange,
      ]
    );

    const buildGroupedPathShape = React.useCallback((strokes, layerId) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      const pathSegments = [];
      for (const stroke of strokes) {
        const { path, thickness, isFilled } = stroke;
        if (!path) continue;

        const bounds = path.getBounds();
        const pad = isFilled ? 0 : Math.max((thickness ?? 1) / 2, 1);
        minX = Math.min(minX, bounds.x - pad);
        minY = Math.min(minY, bounds.y - pad);
        maxX = Math.max(maxX, bounds.x + bounds.width + pad);
        maxY = Math.max(maxY, bounds.y + bounds.height + pad);
        pathSegments.push({
          pathSvg: path.toSVGString(),
          colour: stroke.colour ?? 'black',
          thickness: thickness ?? 8,
          isEraser: !!stroke.isEraser,
          isFilled: !!stroke.isFilled,
          isHighlighter: !!stroke.isHighlighter,
          inputType: stroke.inputType,
          pressure: stroke.pressure,
        });
      }

      if (pathSegments.length === 0) return null;

      const pathBounds = {
        x: minX,
        y: minY,
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
      };
      const firstVisibleSegment =
        pathSegments.find((segment) => !segment.isEraser) ?? pathSegments[0];
      const ts = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      return {
        id: `path-${ts}`,
        type: 'path',
        x: pathBounds.x,
        y: pathBounds.y,
        width: pathBounds.width,
        height: pathBounds.height,
        pathSvg: pathSegments.length === 1 ? pathSegments[0].pathSvg : null,
        pathSegments,
        pathBounds,
        colour: firstVisibleSegment.colour ?? 'black',
        thickness: firstVisibleSegment.thickness ?? 8,
        rotation: 0,
        layer: layerId,
      };
    }, []);

    const convertAllStrokesToShape = React.useCallback(
      (selectCreated = true) => {
        if (allStrokesPath.length === 0) {
          return;
        }

        const pathShape = buildGroupedPathShape(
          allStrokesPath,
          activeLayerIdRef.current
        );
        if (!pathShape) return;

        pushHistory(buildSnapshot(shapes.value));
        const next = [...shapes.value, pathShape];
        shapes.value = next;
        setShapeList(next);
        setAllStrokesPath([]);
        activeStrokePath.value = Skia.Path.Make();
        notifyChange(activeStrokePath);

        if (selectCreated) {
          selectedShapeId.value = pathShape.id;
          selectedShapeStart.value = { x: pathShape.x, y: pathShape.y };
          selectedShapeBounds.value = {
            x: pathShape.x,
            y: pathShape.y,
            width: pathShape.width,
            height: pathShape.height,
          };
          selectedShapeRotation.value = 0;

          notifyChange(selectedShapeId);
          notifyChange(selectedShapeBounds);
          notifyChange(selectedShapeRotation);
          notifySelectedShapeChange(pathShape.id);
        }

        notifyChange(shapes);
      },
      [
        allStrokesPath,
        activeStrokePath,
        buildGroupedPathShape,
        buildSnapshot,
        notifySelectedShapeChange,
        pushHistory,
        selectedShapeBounds,
        selectedShapeId,
        selectedShapeRotation,
        selectedShapeStart,
        shapes,
      ]
    );

    // MW - Called via runOnJS from gesture onBegin handlers before a shape is
    // dragged or rotated. The shapesSnapshot is captured on the UI thread at
    // gesture-start time, before any onUpdate mutation fires, so it reliably
    // reflects the pre-drag position.
    const onBeforeShapeMutation = React.useCallback(
      (shapesSnapshot) => {
        pushHistory(buildSnapshot(shapesSnapshot));
      },
      [pushHistory, buildSnapshot]
    );

    // MW - Background Image Logic - Set canvas size to image size if image is provided, else use canvasWidth and canvasHeight props.
    useEffect(() => {
      let targetWidth = canvasWidth;
      let targetHeight = canvasHeight;

      if (backgroundImage) {
        const imageWidth = backgroundImage.width();
        const imageHeight = backgroundImage.height();
        if (imageWidth && imageHeight) {
          targetWidth = imageWidth;
          targetHeight = imageHeight;
        }
      }

      setResolvedCanvas({ width: targetWidth, height: targetHeight });

      // MW - Fit the (possibly image-sized) paper to the window so large
      // images open fully visible and small papers open filling the screen,
      // then centre it at that scale.
      const fitScale = getFitScale(targetWidth, targetHeight);
      const newX = (windowWidth - targetWidth * fitScale) / 2;
      const newY = (windowHeight - targetHeight * fitScale) / 2;
      scale.value = fitScale;
      savedScale.value = fitScale;
      translateX.value = newX;
      translateY.value = newY;
      savedTranslateX.value = newX;
      savedTranslateY.value = newY;
    }, [
      backgroundImage,
      canvasWidth,
      canvasHeight,
      windowHeight,
      windowWidth,
      getFitScale,
      scale,
      savedScale,
      translateX,
      translateY,
      savedTranslateX,
      savedTranslateY,
    ]);

    const clearSelection = React.useCallback(() => {
      selectedShapeId.value = null;
      selectedShapeStart.value = { x: 0, y: 0 };
      selectedShapeBounds.value = null;
      selectedShapeRotation.value = 0;
      notifyChange(selectedShapeId);
      notifyChange(selectedShapeStart);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);
      notifySelectedShapeChange(null);
    }, [
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
    ]);

    const viewportMatrix = useDerivedValue(() => {
      const matrix = Skia.Matrix();

      const currentScale = scale.value || 1;
      const tx = translateX.value || 0;
      const ty = translateY.value || 0;

      matrix.translate(tx, ty);
      matrix.scale(currentScale, currentScale);
      return matrix;
    });

    const {
      panSelectionGesture,
      rotateSelectionGesture,
      tapSelectionGesture,
      pinchResizeGesture,
    } = useMemo(
      () =>
        createSelectionGestures({
          currentTool,
          scale,
          translateX,
          translateY,
          windowWidth,
          windowHeight,
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
          onSelectedShapeChange: notifySelectedShapeChange,
          onBeforeShapeMutation,
        }),
      [
        currentTool,
        scale,
        translateX,
        translateY,
        windowWidth,
        windowHeight,
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
        notifySelectedShapeChange,
        onBeforeShapeMutation,
      ]
    );

    const { paintGesture } = useMemo(
      () =>
        createPaintGestures({
          currentTool,
          scale,
          translateX,
          translateY,
          canvasWidth: resolvedCanvas.width,
          canvasHeight: resolvedCanvas.height,
          activeStrokePath,
          activeStrokeColour,
          activeStrokeThickness,
          addPathToAllStrokes,
          onStrokeStart: bumpStrokeStart,
        }),
      [
        currentTool,
        scale,
        translateX,
        translateY,
        resolvedCanvas.width,
        resolvedCanvas.height,
        activeStrokePath,
        activeStrokeColour,
        activeStrokeThickness,
        addPathToAllStrokes,
        bumpStrokeStart,
      ]
    );

    const addShape = React.useCallback(
      (shape) => {
        pushHistory(
          buildSnapshot(shapes.value.filter((s) => s.id !== shape.id))
        );

        // MW - Icon shapes carry only geometry from the worklet
        let finalShape =
          shape.type === 'icon' && activeIconDataRef.current
            ? {
                ...shape,
                iconName: activeIconDataRef.current.iconName ?? '',
                iconPath: activeIconDataRef.current.iconPath ?? '',
                iconViewBox: activeIconDataRef.current.iconViewBox ?? {
                  width: 512,
                  height: 512,
                },
              }
            : shape;
        // MW - Correct the icon height so it matches the viewbox aspect ratio.
        // Icons are placed as squares from the gesture worklet (viewbox unknown
        // there), so we fix up the height here once we have the real viewbox.
        if (finalShape.type === 'icon' && finalShape.iconViewBox) {
          const vbW = finalShape.iconViewBox.width;
          const vbH = finalShape.iconViewBox.height;
          if (vbW > 0 && vbH > 0 && vbW !== vbH) {
            finalShape = {
              ...finalShape,
              height: finalShape.width * (vbH / vbW),
            };
          }
        }
        // MW - Replace the bare shape in the shared value with the enriched one.
        if (finalShape !== shape) {
          shapes.value = [
            ...shapes.value.filter((s) => s.id !== shape.id),
            finalShape,
          ];
          notifyChange(shapes);
          // MW - Sync the selection outline bounds to the corrected dimensions.
          if (finalShape.type === 'icon') {
            selectedShapeBounds.value = {
              x: finalShape.x,
              y: finalShape.y,
              width: finalShape.width,
              height: finalShape.height,
            };
            notifyChange(selectedShapeBounds);
          }
        }
        // MW - Stamp the active layer onto the shape so it renders in the
        // correct layer group. Text shapes always stay on 'text'.
        const layeredShape =
          finalShape.type === 'text'
            ? finalShape
            : { ...finalShape, layer: activeLayerIdRef.current };
        if (layeredShape !== finalShape) {
          shapes.value = [
            ...shapes.value.filter((s) => s.id !== shape.id),
            layeredShape,
          ];
          notifyChange(shapes);
        }
        setShapeList((prev) => [
          ...prev.filter((s) => s.id !== shape.id),
          layeredShape,
        ]);

        // MW - When a shape is placed, we switch to the control tool so the user can immediately manipulate it.
        // This is purely a UX Decision if you would like to stay within the shape tool after placing a shape you can remove this line.
        // :)
        setCurrentTool('control');
      },
      [pushHistory, buildSnapshot, shapes, selectedShapeBounds]
    );

    // MW - Drag-to-create: mount a shape that already exists in shapes.value
    // (added on the UI thread at gesture start). We only push history and add
    // it to the React shapeList here — geometry keeps updating live on the UI
    // thread, so we must NOT re-write x/y/width/height (that would fight the
    // in-progress drag).
    const beginShapeCreation = React.useCallback(
      (shape) => {
        pushHistory(
          buildSnapshot(shapes.value.filter((s) => s.id !== shape.id))
        );
        // MW - Icons arrive from the worklet with only geometry (the SVG path
        // and viewBox live on the JS thread in activeIconDataRef). Merge them
        // in NOW so the icon renders and resizes live during the drag, instead
        // of showing just the selection box until release. Geometry is left
        // untouched — the drag keeps advancing x/y/width/height on the UI
        // thread and the aspect ratio is enforced there.
        let enriched = shape;
        if (shape.type === 'icon' && activeIconDataRef.current) {
          enriched = {
            ...shape,
            iconName: activeIconDataRef.current.iconName ?? '',
            iconPath: activeIconDataRef.current.iconPath ?? '',
            iconViewBox: activeIconDataRef.current.iconViewBox ?? {
              width: 512,
              height: 512,
            },
          };
        }
        const layeredShape =
          enriched.type === 'text'
            ? enriched
            : { ...enriched, layer: activeLayerIdRef.current };

        // MW - Reflect the icon path/viewBox + layer back into the live shared
        // value so the array stays consistent, while preserving whatever
        // geometry the drag has already advanced this frame.
        if (layeredShape !== shape) {
          const idx = shapes.value.findIndex((s) => s.id === shape.id);
          if (idx !== -1) {
            const live = shapes.value[idx];
            const next = [...shapes.value];
            next[idx] = {
              ...live,
              layer: layeredShape.layer ?? live.layer,
              iconName: layeredShape.iconName ?? live.iconName,
              iconPath: layeredShape.iconPath ?? live.iconPath,
              iconViewBox: layeredShape.iconViewBox ?? live.iconViewBox,
            };
            shapes.value = next;
            notifyChange(shapes);
          }
        }

        setShapeList((prev) => [
          ...prev.filter((s) => s.id !== shape.id),
          layeredShape,
        ]);
      },
      [pushHistory, buildSnapshot, shapes]
    );

    // MW - Called when a drag-created shape is released. Stamps the active
    // layer (and merges icon data) onto the live shape, then syncs the React
    // shapeList to the final geometry.
    const finalizeShapeCreation = React.useCallback(
      (shapeId) => {
        const idx = shapes.value.findIndex((s) => s.id === shapeId);
        if (idx === -1) return;
        let shape = shapes.value[idx];
        const layerId =
          shape.type === 'text' ? 'text' : activeLayerIdRef.current;
        let changed = false;

        if (shape.layer !== layerId) {
          shape = { ...shape, layer: layerId };
          changed = true;
        }

        if (shape.type === 'icon' && activeIconDataRef.current) {
          const vb = activeIconDataRef.current.iconViewBox ?? {
            width: 512,
            height: 512,
          };
          shape = {
            ...shape,
            iconName: activeIconDataRef.current.iconName ?? '',
            iconPath: activeIconDataRef.current.iconPath ?? '',
            iconViewBox: vb,
          };
          if (vb.width > 0 && vb.height > 0 && vb.width !== vb.height) {
            shape = { ...shape, height: shape.width * (vb.height / vb.width) };
          }
          changed = true;
          selectedShapeBounds.value = {
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
          };
          notifyChange(selectedShapeBounds);
        }

        if (changed) {
          const next = [...shapes.value];
          next[idx] = shape;
          shapes.value = next;
          notifyChange(shapes);
        }
        setShapeList(shapes.value.map((s) => ({ ...s })));
        setCurrentTool('control');
      },
      [shapes, selectedShapeBounds]
    );

    const { controlPanGesture, controlPinchGesture, controlRotateGesture } =
      useMemo(
        () =>
          createControlGestures({
            scale,
            savedScale,
            translateX,
            translateY,
            savedTranslateX,
            savedTranslateY,
            windowWidth,
            windowHeight,
            canvasWidth: resolvedCanvas.width,
            canvasHeight: resolvedCanvas.height,
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
            onSelectedShapeChange: notifySelectedShapeChange,
            onBeforeShapeMutation,
          }),
        [
          scale,
          savedScale,
          translateX,
          translateY,
          savedTranslateX,
          savedTranslateY,
          windowWidth,
          windowHeight,
          resolvedCanvas.width,
          resolvedCanvas.height,
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
          notifySelectedShapeChange,
          onBeforeShapeMutation,
        ]
      );

    const { tapPlaceShapeGesture, dragPlaceShapeGesture } = useMemo(
      () =>
        createShapeGestures({
          currentTool,
          shapeToolType,
          shapes,
          addShape,
          beginShapeCreation,
          finalizeShapeCreation,
          onSelectedShapeChange: notifySelectedShapeChange,
          scale,
          translateX,
          translateY,
          savedTranslateX,
          savedTranslateY,
          windowWidth,
          windowHeight,
          canvasWidth: resolvedCanvas.width,
          canvasHeight: resolvedCanvas.height,
          activeStrokeColour,
          activeStrokeThickness,
          selectedShapeId,
          selectedShapeStart,
          selectedShapeBounds,
          selectedShapeRotation,
          lineAnchor,
          pendingLinePreview,
          activeIconAspect,
        }),
      [
        shapes,
        addShape,
        beginShapeCreation,
        finalizeShapeCreation,
        currentTool,
        shapeToolType,
        scale,
        translateX,
        translateY,
        savedTranslateX,
        savedTranslateY,
        windowWidth,
        windowHeight,
        resolvedCanvas.width,
        resolvedCanvas.height,
        activeStrokeColour,
        activeStrokeThickness,
        selectedShapeId,
        selectedShapeStart,
        selectedShapeBounds,
        selectedShapeRotation,
        notifySelectedShapeChange,
        lineAnchor,
        pendingLinePreview,
        activeIconAspect,
      ]
    );

    // MW - Create a text shape on the JS thread. Measuring the real glyph width
    const deletedSelectedShape = React.useCallback(() => {
      const shapeId = selectedShapeId.value;
      if (!shapeId) return;

      pushHistory(buildSnapshot(shapes.value));
      const nextShapes = shapes.value.filter((s) => s.id !== shapeId);
      shapes.value = nextShapes;
      setShapeList(nextShapes);
      selectedShapeId.value = null;
      selectedShapeStart.value = { x: 0, y: 0 };
      selectedShapeBounds.value = null;
      selectedShapeRotation.value = 0;
      notifyChange(shapes);
      notifyChange(selectedShapeId);
      notifyChange(selectedShapeStart);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);
      notifySelectedShapeChange(null);
    }, [
      shapes,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
      pushHistory,
      buildSnapshot,
    ]);

    // MW - Duplicate the currently selected shape. The copy is offset slightly
    // so it doesn't sit invisibly on top of the original, placed at the end of
    // its layer's render order, and becomes the new selection.
    const duplicateSelectedShape = React.useCallback(() => {
      const shapeId = selectedShapeId.value;
      if (!shapeId) return null;
      const idx = shapes.value.findIndex((s) => s.id === shapeId);
      if (idx === -1) return null;

      pushHistory(buildSnapshot(shapes.value));

      const source = shapes.value[idx];
      const OFFSET = 20;
      const duplicate = {
        ...source,
        id: `${source.type ?? 'shape'}-${Date.now()}-${Math.floor(
          Math.random() * 1000
        )}`,
        x: source.x + OFFSET,
        y: source.y + OFFSET,
      };

      const next = [...shapes.value, duplicate];
      shapes.value = next;
      setShapeList(next);

      // MW - Select the copy, mirroring the bounds logic used elsewhere
      // (circle: centre+radius, text: baseline box, line: signed extent).
      let bounds;
      if (duplicate.type === 'circle') {
        const r = duplicate.radius ?? 10;
        bounds = {
          x: duplicate.x - r,
          y: duplicate.y - r,
          width: r * 2,
          height: r * 2,
        };
      } else if (duplicate.type === 'text') {
        const h = duplicate.height ?? duplicate.fontSize ?? 32;
        bounds = {
          x: duplicate.x,
          y: duplicate.y - h,
          width: duplicate.width ?? 0,
          height: h,
        };
      } else if (duplicate.type === 'line') {
        const w = duplicate.width ?? 0;
        const h = duplicate.height ?? 0;
        bounds = {
          x: Math.min(duplicate.x, duplicate.x + w),
          y: Math.min(duplicate.y, duplicate.y + h),
          width: Math.abs(w),
          height: Math.abs(h),
        };
      } else {
        bounds = {
          x: duplicate.x,
          y: duplicate.y,
          width: duplicate.width,
          height: duplicate.height,
        };
      }

      selectedShapeId.value = duplicate.id;
      selectedShapeStart.value = { x: duplicate.x, y: duplicate.y };
      selectedShapeBounds.value = bounds;
      selectedShapeRotation.value = duplicate.rotation ?? 0;
      notifyChange(shapes);
      notifyChange(selectedShapeId);
      notifyChange(selectedShapeStart);
      notifyChange(selectedShapeBounds);
      notifyChange(selectedShapeRotation);
      notifySelectedShapeChange(duplicate.id);

      return duplicate.id;
    }, [
      shapes,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
      pushHistory,
      buildSnapshot,
    ]);

    // MW - Text editing: modal state, addText/startTextEdit callbacks, and the
    // double-tap gesture are all owned here.
    const {
      editorVisible,
      editorMode,
      editorValue,
      addText,
      onEditorChange,
      submitEditor,
      cancelEditor,
      doubleTapTextGesture,
    } = useTextEditing({
      shapes,
      setShapeList,
      scale,
      translateX,
      translateY,
      activeFontSize,
      activeStrokeColour,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
      pushHistory,
      buildSnapshot,
      defaultTextRef: defaultTextContentRef,
    });

    const { placeTextGesture } = useMemo(
      () =>
        createTextGestures({
          currentTool,
          scale,
          translateX,
          translateY,
          shapes,
          addText,
        }),
      [currentTool, scale, translateX, translateY, shapes, addText]
    );

    // MW - Active Gestures based on current tool.
    const activeGestures = useMemo(() => {
      switch (currentTool) {
        case 'control':
        case 'move':
          // MW - Single smart tool: drag on a shape moves it; drag on empty
          // canvas pans the viewport. Pinch always zooms. Rotate always
          // rotates a selected shape. Always use controlGestures here —
          // they handle the shape-vs-viewport decision internally via
          // isPanningViewport. The old selectedShapeId.value branch was
          // unreliable because useMemo does not track shared-value mutations,
          // so the viewport pan gestures were disabled on first load.
          return Gesture.Simultaneous(
            controlPanGesture,
            controlPinchGesture,
            controlRotateGesture,
            doubleTapTextGesture
          );
        case 'selection':
          return Gesture.Simultaneous(
            panSelectionGesture,
            rotateSelectionGesture,
            tapSelectionGesture,
            pinchResizeGesture,
            doubleTapTextGesture
          );
        case 'paint':
        case 'eraser':
        case 'highlighter':
          return paintGesture;
        case 'shape':
        case 'icon':
          // MW - Shape/icon mode only places new shapes. Existing-shape
          // selection and movement are handled by control mode.
          return Gesture.Simultaneous(
            dragPlaceShapeGesture,
            tapPlaceShapeGesture
          );
        case 'text':
          return Gesture.Simultaneous(placeTextGesture, doubleTapTextGesture);
        default:
          return Gesture.Exclusive();
      }
    }, [
      currentTool,
      controlPanGesture,
      controlPinchGesture,
      controlRotateGesture,
      panSelectionGesture,
      rotateSelectionGesture,
      tapSelectionGesture,
      paintGesture,
      placeTextGesture,
      tapPlaceShapeGesture,
      dragPlaceShapeGesture,
      doubleTapTextGesture,
      pinchResizeGesture,
    ]);

    const paperRect = rect(0, 0, resolvedCanvas.width, resolvedCanvas.height);

    const SELECTION_OFFSET = 5;
    const maxSelectionWidth = resolvedCanvas.width * 0.9;
    const selectionX = useDerivedValue(
      () => (selectedShapeBounds.value?.x ?? 0) - SELECTION_OFFSET
    );
    const selectionY = useDerivedValue(
      () => (selectedShapeBounds.value?.y ?? 0) - SELECTION_OFFSET
    );
    const selectionWidth = useDerivedValue(() => {
      const id = selectedShapeId.value;
      if (id && mountedShapeIds.value.findIndex((mid) => mid === id) === -1) {
        return 0;
      }
      const w = selectedShapeBounds.value?.width ?? 0;
      if (w === 0) return 0;
      return Math.min(w, maxSelectionWidth) + SELECTION_OFFSET * 2;
    });
    const selectionHeight = useDerivedValue(() => {
      const id = selectedShapeId.value;
      if (id && mountedShapeIds.value.findIndex((mid) => mid === id) === -1) {
        return 0;
      }
      const h = selectedShapeBounds.value?.height ?? 0;
      if (h === 0) return 0;
      return h + SELECTION_OFFSET * 2;
    });
    const selectionOrigin = useDerivedValue(() => {
      const b = selectedShapeBounds.value;
      return b
        ? { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        : { x: 0, y: 0 };
    });
    const selectionTransform = useDerivedValue(() => [
      { rotate: ((selectedShapeRotation.value ?? 0) * Math.PI) / 180 },
    ]);

    // MW - Two-tap line placement marker. Driven entirely on the UI thread;
    // radius is divided by the current scale so it stays a constant on-screen
    // size, and collapses to 0 when no anchor is pending.
    const pendingMarkerCx = useDerivedValue(
      () => pendingLinePreview.value?.x ?? 0
    );
    const pendingMarkerCy = useDerivedValue(
      () => pendingLinePreview.value?.y ?? 0
    );
    const pendingMarkerR = useDerivedValue(() =>
      pendingLinePreview.value?.active ? 6 / (scale.value || 1) : 0
    );

    // MW - Reset any pending line anchor when the user leaves the line tool so
    // a half-placed line can't be completed after switching tools/shapes.
    useEffect(() => {
      if (currentTool !== 'shape' || shapeToolType !== 'line') {
        lineAnchor.value = null;
        pendingLinePreview.value = { active: false, x: 0, y: 0 };
        notifyChange(lineAnchor);
        notifyChange(pendingLinePreview);
      }
    }, [currentTool, shapeToolType, lineAnchor, pendingLinePreview]);

    // MW - Clear Canvas Function
    const clearCanvas = React.useCallback(() => {
      pushHistory(buildSnapshot(shapes.value));
      shapes.value = [];
      setAllStrokesPath([]);
      setShapeList([]);
      selectedShapeId.value = null;
      selectedShapeStart.value = { x: 0, y: 0 };
      selectedShapeBounds.value = null;
      selectedShapeRotation.value = 0;
      notifyChange(shapes);
      notifySelectedShapeChange(null);
    }, [
      shapes,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      pushHistory,
      buildSnapshot,
      notifySelectedShapeChange,
    ]);

    const setColour = React.useCallback(
      (colour) => {
        setCurrentColour(colour);

        const shapeId = selectedShapeId.value;

        if (!shapeId) {
          // No shape selected — update the global paint/stroke colour used for
          // new strokes and shapes.
          activeStrokeColour.value = colour;
          return;
        }

        const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
        if (shapeIndex === -1) {
          activeStrokeColour.value = colour;
          return;
        }

        pushHistory(buildSnapshot(shapes.value));
        const updatedShape = {
          ...shapes.value[shapeIndex],
          colour,
        };

        // MW - Reassign a new array (not in-place mutation) so Reanimated
        // propagates the change to the UI thread and ShapeNode's derived colour
        // re-evaluates. Mutating shapes.value[i] directly would not update the
        // UI-thread copy, so the rendered colour would never change.
        const updatedShapes = [...shapes.value];
        updatedShapes[shapeIndex] = updatedShape;
        shapes.value = updatedShapes;
        // MW - Also update the global active colour so newly placed shapes use
        // the same colour as the one just changed.
        activeStrokeColour.value = colour;
        notifyChange(shapes);
      },
      [activeStrokeColour, shapes, selectedShapeId, pushHistory, buildSnapshot]
    );

    const setBrushSize = React.useCallback(
      (size) => {
        activeStrokeThickness.value = size;

        const shapeId = selectedShapeId.value;
        if (!shapeId) return;

        const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
        if (shapeIndex === -1) return;

        const shape = shapes.value[shapeIndex];
        // MW - Text size is handled by setFontSize, not the brush slider.
        if (shape.type === 'text') return;

        pushHistory(buildSnapshot(shapes.value));

        // MW - Map the slider value to a canvas size using the same * 5 factor
        // used when placing new shapes (slider range 2–40 → canvas size 10–200).
        const newSize = size * 5;

        let updatedShape;
        if (shape.type === 'circle') {
          updatedShape = { ...shape, radius: newSize / 2 };
        } else {
          // MW - Scale width/height proportionally to preserve the shape's aspect ratio.
          const aspect = shape.width > 0 ? shape.height / shape.width : 1;
          updatedShape = {
            ...shape,
            width: newSize,
            height: newSize * aspect,
          };
        }

        const updatedShapes = [...shapes.value];
        updatedShapes[shapeIndex] = updatedShape;
        shapes.value = updatedShapes;
        setShapeList(updatedShapes);
        notifyChange(shapes);

        // MW - Keep the selection outline in sync with the new dimensions.
        if (updatedShape.type === 'circle') {
          selectedShapeBounds.value = {
            x: updatedShape.x - updatedShape.radius,
            y: updatedShape.y - updatedShape.radius,
            width: updatedShape.radius * 2,
            height: updatedShape.radius * 2,
          };
        } else {
          selectedShapeBounds.value = {
            x: updatedShape.x,
            y: updatedShape.y,
            width: updatedShape.width,
            height: updatedShape.height,
          };
        }
        notifyChange(selectedShapeBounds);
      },
      [
        activeStrokeThickness,
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        pushHistory,
        buildSnapshot,
      ]
    );

    const setFontSize = React.useCallback(
      (size) => {
        const shapeId = selectedShapeId.value;

        activeFontSize.value = size;

        if (!shapeId) {
          // Set global font size for new text shapes if no shape is selected.
          return;
        }

        const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
        if (shapeIndex === -1) return;

        const updatedShape = {
          ...shapes.value[shapeIndex],
          fontSize: size,
        };

        // MW - Re-measure the glyphs at the new size and store the real
        // width/height on the shape so the hit-test, selection box and rotation
        // pivot all stay exact as the text resizes.
        if (updatedShape.type === 'text') {
          const { width: tw, height: th } = measureText(
            updatedShape.content,
            size
          );
          updatedShape.width = tw;
          updatedShape.height = th;
        }

        // MW - Reassign a new array (not in-place mutation) so Reanimated
        // propagates the change to the UI thread and ShapeNode's derived font
        // re-evaluates. Mutating shapes.value[i] directly would not update the
        // UI-thread copy, so the rendered text size would never change.
        pushHistory(buildSnapshot(shapes.value));
        const updatedShapes = [...shapes.value];
        updatedShapes[shapeIndex] = updatedShape;
        shapes.value = updatedShapes;
        setShapeList(updatedShapes);
        notifyChange(shapes);

        // MW - Keep the selection outline glued to the text as it resizes. Text
        // draws from its baseline, so the box top sits one text-height above y.
        if (updatedShape.type === 'text') {
          selectedShapeBounds.value = {
            x: updatedShape.x,
            y: updatedShape.y - updatedShape.height,
            width: updatedShape.width,
            height: updatedShape.height,
          };
          notifyChange(selectedShapeBounds);
        }
      },
      [
        activeFontSize,
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        pushHistory,
        buildSnapshot,
      ]
    );

    // MW - Set the text content. When a text shape is selected its content is
    // updated (and re-measured) in place; otherwise the value becomes the
    // default content used the next time a text shape is placed.
    const setText = React.useCallback(
      (text) => {
        const value = text == null ? '' : String(text);

        if (!value) {
          deletedSelectedShape();
          Alert.alert(
            'No Text Was Entered',
            'You can not place a text shape without any text. Please enter some text and try again.'
          );
          return;
        }

        const shapeId = selectedShapeId.value;

        if (shapeId) {
          const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
          if (shapeIndex !== -1 && shapes.value[shapeIndex].type === 'text') {
            pushHistory(buildSnapshot(shapes.value));
            const shape = shapes.value[shapeIndex];
            const { width: tw, height: th } = measureText(
              value || ' ',
              shape.fontSize ?? 32
            );
            const updatedShape = {
              ...shape,
              content: value,
              width: tw,
              height: th,
            };
            const updatedShapes = [...shapes.value];
            updatedShapes[shapeIndex] = updatedShape;
            shapes.value = updatedShapes;
            setShapeList(updatedShapes);
            notifyChange(shapes);

            selectedShapeBounds.value = {
              x: updatedShape.x,
              y: updatedShape.y - th,
              width: tw,
              height: th,
            };
            notifyChange(selectedShapeBounds);
            return;
          }
        }

        setCurrentTool('control');
        // No text shape selected — remember it for the next placed text.
        defaultTextContentRef.current = value || ' ';
      },
      [
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        pushHistory,
        buildSnapshot,
        deletedSelectedShape,
      ]
    );

    // MW - Create a new user layer inserted above 'shapes' (before 'text').
    // The caller can supply a display name; it becomes the active layer.
    const addLayer = React.useCallback((name) => {
      const id = `layer-${Date.now()}`;
      const displayName = name || 'Layer';
      setLayers((prev) => {
        const textIdx = prev.findIndex((l) => l.id === 'text');
        const insertAt = textIdx === -1 ? prev.length : textIdx;
        const next = [...prev];
        next.splice(insertAt, 0, { id, name: displayName });
        return next;
      });
      setActiveLayerId(id);
      return id;
    }, []);

    // MW - Remove a user layer. Built-in layers ('drawing', 'shapes', 'text')
    // are protected. Shapes on the removed layer are reassigned to 'shapes'.
    const removeLayer = React.useCallback(
      (layerId) => {
        const PROTECTED = ['underlayer', 'drawing', 'shapes', 'text'];
        if (PROTECTED.includes(layerId)) return;
        // Reassign orphaned shapes to the default shapes layer.
        const next = shapes.value.map((s) =>
          s.layer === layerId ? { ...s, layer: 'shapes' } : s
        );
        shapes.value = next;
        notifyChange(shapes);
        setShapeList(next);
        setLayers((prev) => prev.filter((l) => l.id !== layerId));
        // If the removed layer was active, fall back to 'shapes'.
        setActiveLayerId((prev) => (prev === layerId ? 'shapes' : prev));
      },
      [shapes]
    );

    // MW - Duplicate a layer and all shapes assigned to it. Defaults to the
    // currently active layer (the selected layer in the host UI) and makes the
    // duplicate active so follow-up drawing targets the new layer.
    const duplicateLayer = React.useCallback(
      (layerId = activeLayerIdRef.current, name = null) => {
        if (!layerId || layerId === 'drawing') return null;

        const currentLayers = layersRef.current;
        const sourceLayer = currentLayers.find((layer) => layer.id === layerId);
        if (!sourceLayer) return null;

        pushHistory(buildSnapshot(shapes.value));

        const duplicateId = `layer-${Date.now()}-${Math.floor(
          Math.random() * 1000
        )}`;
        const duplicateName = name || `${sourceLayer.name || 'Layer'} Copy`;
        const sourceIndex = currentLayers.findIndex(
          (layer) => layer.id === layerId
        );
        const nextLayers = [...currentLayers];
        nextLayers.splice(sourceIndex + 1, 0, {
          ...sourceLayer,
          id: duplicateId,
          name: duplicateName,
        });

        const duplicatedShapes = shapes.value
          .filter((shape) => getShapeLayer(shape) === layerId)
          .map((shape) => ({
            ...shape,
            id: `${shape.id}-copy-${Date.now()}-${Math.floor(
              Math.random() * 1000
            )}`,
            layer: duplicateId,
          }));
        const nextShapes = [...shapes.value, ...duplicatedShapes];

        setLayers(nextLayers);
        shapes.value = nextShapes;
        setShapeList(nextShapes);
        setActiveLayerId(duplicateId);
        notifyChange(shapes);

        return duplicateId;
      },
      [buildSnapshot, pushHistory, shapes]
    );

    // MW - Move a shape to a different layer.
    const moveShapeToLayer = React.useCallback(
      (shapeId, layerId) => {
        const id = shapeId ?? selectedShapeId.value;
        if (!id) return;
        pushHistory(buildSnapshot(shapes.value));
        const next = shapes.value.map((s) =>
          s.id === id ? { ...s, layer: layerId } : s
        );
        shapes.value = next;
        notifyChange(shapes);
        setShapeList(next);
      },
      [shapes, selectedShapeId, pushHistory, buildSnapshot]
    );

    // MW - Move a layer one step up (toward the front) in the render order.
    const moveLayerUp = React.useCallback(
      (layerId) => {
        const idx = layersRef.current.findIndex((l) => l.id === layerId);
        if (idx >= layersRef.current.length - 1) return;
        pushHistory(buildSnapshot(shapes.value));
        setLayers((prev) => {
          const i = prev.findIndex((l) => l.id === layerId);
          if (i >= prev.length - 1) return prev;
          const next = [...prev];
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
          return next;
        });
      },
      [pushHistory, buildSnapshot, shapes]
    );

    // MW - Move a layer one step down (toward the back) in the render order.
    const moveLayerDown = React.useCallback(
      (layerId) => {
        const idx = layersRef.current.findIndex((l) => l.id === layerId);
        if (idx <= 0) return;
        pushHistory(buildSnapshot(shapes.value));
        setLayers((prev) => {
          const i = prev.findIndex((l) => l.id === layerId);
          if (i <= 0) return prev;
          const next = [...prev];
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
          return next;
        });
      },
      [pushHistory, buildSnapshot, shapes]
    );

    // MW - Move a shape one step forward within its layer (swap with the next
    // shape in the same layer, which renders it on top of that shape).
    const bringShapeForward = React.useCallback(
      (shapeId) => {
        const currentShapes = shapes.value;
        const idx = currentShapes.findIndex((s) => s.id === shapeId);
        if (idx === -1) return;
        const shapeLayer = getShapeLayer(currentShapes[idx]);
        let nextIdx = -1;
        for (let i = idx + 1; i < currentShapes.length; i++) {
          if (getShapeLayer(currentShapes[i]) === shapeLayer) {
            nextIdx = i;
            break;
          }
        }
        if (nextIdx === -1) return;
        pushHistory(buildSnapshot(currentShapes));
        const next = [...currentShapes];
        [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
        shapes.value = next;
        setShapeList(next);
        notifyChange(shapes);
      },
      [shapes, pushHistory, buildSnapshot]
    );

    // MW - Convert a shape to a committed drawing-layer stroke so it can be
    // painted/erased over. The shape is removed from the selectable list.
    const flattenShape = React.useCallback(
      (shapeId) => {
        const currentShapes = shapes.value;
        const idx = currentShapes.findIndex((s) => s.id === shapeId);
        if (idx === -1) return;
        const shape = currentShapes[idx];
        if (shape.type === 'text') return; // text can't be meaningfully path-flattened

        let flatPath;
        if (shape.type === 'circle') {
          flatPath = Skia.Path.Make();
          flatPath.addCircle(shape.x, shape.y, shape.radius ?? 10);
        } else {
          const svgStr = buildFlattenedPath(shape);
          flatPath = Skia.Path.MakeFromSVGString(svgStr) ?? Skia.Path.Make();
        }
        const strokeStyleTypes = ['line', 'arrow', 'cross', 'check'];
        const isFilled = !strokeStyleTypes.includes(shape.type);

        pushHistory(buildSnapshot(currentShapes));
        setAllStrokesPath((prev) => [
          ...prev,
          {
            path: flatPath,
            colour: shape.colour ?? 'black',
            isEraser: false,
            thickness: 2,
            isFilled,
          },
        ]);
        const next = currentShapes.filter((s) => s.id !== shapeId);
        shapes.value = next;
        setShapeList(next);
        notifyChange(shapes);
        if (selectedShapeId.value === shapeId) {
          selectedShapeId.value = null;
          selectedShapeBounds.value = null;
          selectedShapeRotation.value = 0;
          selectedShapeStart.value = { x: 0, y: 0 };
          notifySelectedShapeChange(null);
        }
      },
      [
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        selectedShapeRotation,
        selectedShapeStart,
        pushHistory,
        buildSnapshot,
        notifySelectedShapeChange,
      ]
    );

    // MW - Move a shape one step backward within its layer.
    // If already at the back, flatten it into the drawing layer.
    const sendShapeBackward = React.useCallback(
      (shapeId) => {
        const currentShapes = shapes.value;
        const idx = currentShapes.findIndex((s) => s.id === shapeId);
        if (idx === -1) return;
        const shapeLayer = getShapeLayer(currentShapes[idx]);
        let prevIdx = -1;
        for (let i = idx - 1; i >= 0; i--) {
          if (getShapeLayer(currentShapes[i]) === shapeLayer) {
            prevIdx = i;
            break;
          }
        }
        if (prevIdx === -1) {
          if (shapeLayer === 'underlayer') {
            // Already behind all paint strokes — flatten into the drawing layer.
            flattenShape(shapeId);
          } else {
            // Move to underlayer so the shape renders behind paint strokes.
            pushHistory(buildSnapshot(currentShapes));
            const next = currentShapes.map((s) =>
              s.id === shapeId ? { ...s, layer: 'underlayer' } : s
            );
            shapes.value = next;
            notifyChange(shapes);
            setShapeList(next);
          }
          return;
        }
        pushHistory(buildSnapshot(currentShapes));
        const next = [...currentShapes];
        [next[idx], next[prevIdx]] = [next[prevIdx], next[idx]];
        shapes.value = next;
        setShapeList(next);
        notifyChange(shapes);
      },
      [shapes, pushHistory, buildSnapshot, flattenShape]
    );

    // MW - Bring a shape to the very front of its layer.
    const bringShapeToFront = React.useCallback(
      (shapeId) => {
        const currentShapes = shapes.value;
        const idx = currentShapes.findIndex((s) => s.id === shapeId);
        if (idx === -1) return;
        const shapeLayer = getShapeLayer(currentShapes[idx]);
        let lastLayerIdx = idx;
        for (let i = currentShapes.length - 1; i > idx; i--) {
          if (getShapeLayer(currentShapes[i]) === shapeLayer) {
            lastLayerIdx = i;
            break;
          }
        }
        if (lastLayerIdx === idx) return;
        pushHistory(buildSnapshot(currentShapes));
        const shape = currentShapes[idx];
        const next = [...currentShapes];
        next.splice(idx, 1);
        // After removing idx the original lastLayerIdx is now 1 position
        // earlier, so inserting at lastLayerIdx places it right after.
        next.splice(lastLayerIdx, 0, shape);
        shapes.value = next;
        setShapeList(next);
        notifyChange(shapes);
      },
      [shapes, pushHistory, buildSnapshot]
    );

    // MW - Send a shape to the very back of its layer.
    const sendShapeToBack = React.useCallback(
      (shapeId) => {
        const currentShapes = shapes.value;
        const idx = currentShapes.findIndex((s) => s.id === shapeId);
        if (idx === -1) return;
        const shapeLayer = getShapeLayer(currentShapes[idx]);
        let firstLayerIdx = idx;
        for (let i = 0; i < idx; i++) {
          if (getShapeLayer(currentShapes[i]) === shapeLayer) {
            firstLayerIdx = i;
            break;
          }
        }
        if (firstLayerIdx === idx) return;
        pushHistory(buildSnapshot(currentShapes));
        const shape = currentShapes[idx];
        const next = [...currentShapes];
        next.splice(idx, 1);
        next.splice(firstLayerIdx, 0, shape);
        shapes.value = next;
        setShapeList(next);
        notifyChange(shapes);
      },
      [shapes, pushHistory, buildSnapshot]
    );

    // MW - Serialize the full canvas state (layers, shapes, strokes) to a JSON
    // string. Skia Path objects are converted to SVG path strings so the data
    // is plain-text and can be persisted to any storage the host app chooses.
    const serializeCanvas = React.useCallback(() => {
      const serializedStrokes = allStrokesRef.current.map((stroke) => ({
        pathSvg: stroke.path.toSVGString(),
        colour: stroke.colour,
        thickness: stroke.thickness,
        isEraser: stroke.isEraser,
        isHighlighter: stroke.isHighlighter,
        isFilled: stroke.isFilled ?? false,
        inputType: stroke.inputType,
        pressure: stroke.pressure,
      }));

      return JSON.stringify({
        version: 1,
        layers: layersRef.current.map((l) => ({ ...l })),
        shapes: shapes.value,
        strokes: serializedStrokes,
      });
    }, [shapes]);

    // MW - Restore a canvas state previously returned by serializeCanvas.
    // Accepts either a JSON string or an already-parsed object.
    const loadCanvas = React.useCallback(
      (input) => {
        const data = typeof input === 'string' ? JSON.parse(input) : input;

        if (!data || typeof data !== 'object') {
          throw new Error('loadCanvas: invalid canvas data');
        }

        // MW - Snapshot the current state before overwriting so the load is
        // undoable via the undo stack.
        pushHistory(buildSnapshot(shapes.value));

        // MW - Reconstruct Skia paths from the stored SVG strings.
        const restoredStrokes = (data.strokes ?? []).map((s) => ({
          path:
            Skia.Path.MakeFromSVGString(s.pathSvg ?? '') ?? Skia.Path.Make(),
          colour: s.colour ?? 'black',
          thickness: s.thickness ?? 8,
          isEraser: s.isEraser ?? false,
          isHighlighter: s.isHighlighter ?? false,
          isFilled: s.isFilled ?? false,
          inputType: s.inputType,
          pressure: s.pressure,
        }));

        const restoredLayers = data.layers ?? [
          { id: 'underlayer', name: 'Under Paint' },
          { id: 'drawing', name: 'Drawing' },
          { id: 'shapes', name: 'Shapes' },
          { id: 'text', name: 'Text' },
        ];

        const restoredShapes = data.shapes ?? [];

        setLayers(restoredLayers);
        shapes.value = restoredShapes;
        setShapeList(restoredShapes);
        notifyChange(shapes);
        setAllStrokesPath(restoredStrokes);

        // MW - Clear any active selection and in-progress stroke.
        selectedShapeId.value = null;
        selectedShapeStart.value = { x: 0, y: 0 };
        selectedShapeBounds.value = null;
        selectedShapeRotation.value = 0;
        notifySelectedShapeChange(null);
        activeStrokePath.value = Skia.Path.Make();
        notifyChange(activeStrokePath);
      },
      [
        shapes,
        selectedShapeId,
        selectedShapeStart,
        selectedShapeBounds,
        selectedShapeRotation,
        activeStrokePath,
        pushHistory,
        buildSnapshot,
        notifySelectedShapeChange,
      ]
    );

    // MW - If initial serialized data was provided (e.g. auto-loaded project),
    // restore it synchronously before the first paint so the canvas never
    // appears empty to the user.
    useLayoutEffect(() => {
      if (initialData) {
        loadCanvas(initialData);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveCanvasAsImage = React.useCallback(async () => {
      const surface = Skia.Surface.MakeOffscreen(
        resolvedCanvas.width,
        resolvedCanvas.height
      );

      if (!surface) {
        throw new Error('Failed to create offscreen surface for saving.');
      }

      const canvas = surface.getCanvas();
      // MW - Shape types rendered as strokes (not fills).
      const strokeStyleTypes = ['line', 'arrow', 'cross', 'check'];

      // MW - Draw background image first. It is immutable — eraser strokes
      // must never punch through to it.
      if (backgroundImage) {
        canvas.drawImageRect(
          backgroundImage,
          rect(0, 0, backgroundImage.width(), backgroundImage.height()),
          rect(0, 0, resolvedCanvas.width, resolvedCanvas.height),
          Skia.Paint()
        );
      }

      // MW - Draw layers in render order (bottom to top). Background image is
      // always beneath all layers and has already been drawn above. The drawing
      // layer is drawn last so committed paint remains above shapes/text,
      // matching the live active-stroke overlay in the interactive canvas.
      const orderedSaveLayers = [
        ...layers.filter((layer) => layer.id !== 'drawing'),
        ...layers.filter((layer) => layer.id === 'drawing'),
      ];
      orderedSaveLayers.forEach((layer) => {
        if (layer.id === 'drawing') {
          // MW - saveLayer creates an isolated offscreen compositing buffer.
          // BlendMode.Clear on eraser strokes only erases within this buffer,
          // so the background image pixels remain untouched.
          canvas.saveLayer();
          allStrokesPath.forEach((stroke) => {
            const {
              path,
              colour,
              thickness,
              isEraser,
              isFilled,
              isHighlighter,
            } = stroke;
            const paint = Skia.Paint();
            paint.setColor(Skia.Color(colour ?? 'black'));
            if (isFilled) {
              paint.setStyle(PaintStyle.Fill);
            } else {
              paint.setStyle(PaintStyle.Stroke);
              paint.setStrokeWidth(thickness ?? 8);
              paint.setStrokeCap(
                isHighlighter ? StrokeCap.Square : StrokeCap.Round
              );
              paint.setStrokeJoin(
                isHighlighter ? StrokeJoin.Miter : StrokeJoin.Round
              );
            }
            if (isEraser) {
              paint.setBlendMode(BlendMode.Clear);
            }
            canvas.drawPath(path, paint);
          });
          canvas.restore();
        } else {
          // Draw shapes / text belonging to this layer
          shapes.value
            .filter((s) => getShapeLayer(s) === layer.id)
            .forEach((shape) => {
              const {
                x,
                y,
                width: w,
                height: h,
                colour,
                rotation,
                type,
              } = shape;
              const paint = Skia.Paint();
              paint.setColor(Skia.Color(colour));

              if (type === 'circle') {
                // MW - Circles are symmetric; rotation has no visual effect.
                paint.setStyle(PaintStyle.Fill);
                canvas.drawCircle(x, y, shape.radius ?? 10, paint);
                return;
              }

              if (type === 'icon') {
                const iconSvgPath = shape.iconPath
                  ? Skia.Path.MakeFromSVGString(shape.iconPath)
                  : null;
                try {
                  if (!iconSvgPath) return;
                  const vbW = shape.iconViewBox?.width ?? 512;
                  const vbH = shape.iconViewBox?.height ?? 512;
                  canvas.save();
                  canvas.rotate(rotation ?? 0, x + w / 2, y + h / 2);
                  canvas.translate(x, y);
                  canvas.scale(w / vbW, h / vbH);
                  paint.setStyle(PaintStyle.Fill);
                  canvas.drawPath(iconSvgPath, paint);
                  canvas.restore();
                } finally {
                  safeDispose(iconSvgPath);
                }
                return;
              }

              if (type === 'path') {
                const pathSegments = shape.pathSegments?.length
                  ? shape.pathSegments
                  : shape.pathSvg
                    ? [
                        {
                          pathSvg: shape.pathSvg,
                          colour,
                          thickness: shape.thickness,
                          isEraser: false,
                          isFilled: false,
                          isHighlighter: false,
                        },
                      ]
                    : [];
                if (pathSegments.length > 0) {
                  const source = shape.pathBounds ?? {
                    x,
                    y,
                    width: w || 1,
                    height: h || 1,
                  };
                  const sourceWidth = source.width || 1;
                  const sourceHeight = source.height || 1;
                  canvas.save();
                  canvas.rotate(rotation ?? 0, x + w / 2, y + h / 2);
                  canvas.translate(x, y);
                  canvas.scale(w / sourceWidth, h / sourceHeight);
                  canvas.translate(-(source.x ?? 0), -(source.y ?? 0));
                  if (pathSegments.some((segment) => segment.isEraser)) {
                    canvas.saveLayer();
                  }
                  pathSegments.forEach((segment) => {
                    const customPath = segment.pathSvg
                      ? Skia.Path.MakeFromSVGString(segment.pathSvg)
                      : null;
                    try {
                      if (!customPath) return;
                      const segmentPaint = Skia.Paint();
                      segmentPaint.setColor(
                        Skia.Color(segment.colour ?? colour)
                      );
                      if (segment.isFilled) {
                        segmentPaint.setStyle(PaintStyle.Fill);
                      } else {
                        segmentPaint.setStyle(PaintStyle.Stroke);
                        segmentPaint.setStrokeWidth(segment.thickness ?? 8);
                        segmentPaint.setStrokeCap(
                          segment.isHighlighter
                            ? StrokeCap.Square
                            : StrokeCap.Round
                        );
                        segmentPaint.setStrokeJoin(
                          segment.isHighlighter
                            ? StrokeJoin.Miter
                            : StrokeJoin.Round
                        );
                      }
                      if (segment.isEraser) {
                        segmentPaint.setBlendMode(BlendMode.Clear);
                      }
                      canvas.drawPath(customPath, segmentPaint);
                    } finally {
                      safeDispose(customPath);
                    }
                  });
                  if (pathSegments.some((segment) => segment.isEraser)) {
                    canvas.restore();
                  }
                  canvas.restore();
                }
                return;
              }

              if (type === 'text') {
                const fontSize = shape.fontSize || 32;
                const font = Skia.Font(getSharedTypeface(), fontSize);
                paint.setColor(Skia.Color(colour));
                // MW - Text pivots around its visual centre (x + w/2, y - h/2),
                // mirroring the ShapeNode origin calculation.
                const textH = shape.height ?? fontSize;
                canvas.save();
                canvas.rotate(rotation ?? 0, x + (w ?? 0) / 2, y - textH / 2);
                canvas.drawText(shape.content, x, y, paint, font);
                canvas.restore();
                return;
              }

              // MW - All remaining shape types (rect, line, triangle, arrow,
              // star, diamond, cross, check) are handled via buildFlattenedPath
              // which bakes rotation directly into the path coordinates, so no
              // separate canvas.rotate() call is needed.
              const svgStr = buildFlattenedPath(shape);
              if (!svgStr) return;
              const skPath = Skia.Path.MakeFromSVGString(svgStr);
              if (!skPath) return;
              try {
                if (strokeStyleTypes.includes(type)) {
                  paint.setStyle(PaintStyle.Stroke);
                  paint.setStrokeWidth(2);
                  paint.setStrokeCap(StrokeCap.Round);
                  paint.setStrokeJoin(StrokeJoin.Round);
                } else {
                  paint.setStyle(PaintStyle.Fill);
                }
                canvas.drawPath(skPath, paint);
              } finally {
                safeDispose(skPath);
              }
            });
        }
      });

      surface.flush();

      const imageSnapshot = surface.makeImageSnapshot();
      try {
        const base64 = imageSnapshot.encodeToBase64();
        return `data:image/png;base64,${base64}`;
      } finally {
        // MW - Release the offscreen surface and its snapshot. Both are large
        // native allocations (a full canvas-sized buffer each); without this
        // every save leaked a surface + image, quickly exhausting native heap
        // when saving is triggered repeatedly (e.g. autosave).
        safeDispose(imageSnapshot);
        safeDispose(surface);
      }
    }, [resolvedCanvas, backgroundImage, layers, allStrokesPath, shapes]);

    const closeKeyboard = React.useCallback(() => {
      if (editorVisible) {
        cancelEditor();
      }
      Keyboard.dismiss();
    }, [editorVisible, cancelEditor]);

    useEffect(() => {
      if (active) return;
      setCanvasReady(false);
      draggingShape.value = false;
      dragLastTransX.value = 0;
      dragLastTransY.value = 0;
      edgePanX.value = 0;
      edgePanY.value = 0;
      lineAnchor.value = null;
      pendingLinePreview.value = { active: false, x: 0, y: 0 };
      activeStrokePath.value = Skia.Path.Make();
      cancelEditor();
      Keyboard.dismiss();
    }, [
      active,
      activeStrokePath,
      cancelEditor,
      draggingShape,
      dragLastTransX,
      dragLastTransY,
      edgePanX,
      edgePanY,
      lineAnchor,
      pendingLinePreview,
    ]);

    // MW - Memoise the window-sized canvas style so a new object isn't
    // allocated on every render (only when the window dimensions change).
    const canvasStyle = useMemo(
      () => ({ width: windowWidth, height: windowHeight }),
      [windowWidth, windowHeight]
    );

    React.useImperativeHandle(
      ref,
      () => ({
        clearCanvas,
        setCurrentTool: (tool) => {
          if (
            ((currentTool === 'paint' && tool !== 'paint') ||
              (currentTool === 'highlighter' && tool !== 'highlighter')) &&
            tool !== 'eraser'
          ) {
            // MW - If leaving the paint tool collapse all current paths into a single committed stroke that they can move and resize.
            convertAllStrokesToShape(tool === 'control');
          }
          setCurrentTool(tool);
        },
        getCurrentTool: () => currentTool,
        setColour,
        getCurrentColour: () => currentColour,
        setBrushSize,
        getCurrentBrushSize: () => activeStrokeThickness.value,
        convertAllStrokesToShape,
        saveCanvasAsImage,
        serializeCanvas,
        loadCanvas,
        setFontSize,
        getCurrentFontSize: () => activeFontSize.value,
        setText,
        closeKeyboard,
        deleteSelectedShape: deletedSelectedShape,
        deletedSelectedShape,
        duplicateSelectedShape,
        hasSelectedShape: () => selectedShapeId.value != null,
        setShape: (type) => {
          setShapeToolType(type);
          // MW - If a shape is already selected and we're in shape mode, morph
          // it into the newly chosen shape type instead of waiting for a tap.
          if (currentTool === 'shape' && selectedShapeId.value != null) {
            const shapeId = selectedShapeId.value;
            const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
            if (shapeIndex !== -1) {
              pushHistory(buildSnapshot(shapes.value));
              const existing = shapes.value[shapeIndex];
              // MW - Build a base shape preserving position, size, colour, rotation, layer.
              let updatedShape = {
                ...existing,
                type,
                // Remove icon-specific fields when switching away from icon.
                iconName: undefined,
                iconPath: undefined,
                iconViewBox: undefined,
              };
              // MW - Convert between circle (cx/cy + radius) and rect-like (x/y + w/h).
              if (type === 'circle' && existing.type !== 'circle') {
                const w = existing.width ?? 0;
                const h = existing.height ?? 0;
                updatedShape = {
                  ...updatedShape,
                  x: existing.x + w / 2,
                  y: existing.y + h / 2,
                  radius: Math.min(w, h) / 2,
                  width: undefined,
                  height: undefined,
                };
              } else if (existing.type === 'circle' && type !== 'circle') {
                const r = existing.radius ?? 0;
                updatedShape = {
                  ...updatedShape,
                  x: existing.x - r,
                  y: existing.y - r,
                  width: r * 2,
                  height: r * 2,
                  radius: undefined,
                };
              }
              const updatedShapes = [...shapes.value];
              updatedShapes[shapeIndex] = updatedShape;
              shapes.value = updatedShapes;
              setShapeList(updatedShapes);
              notifyChange(shapes);
            }
          }
        },
        getCurrentShape: () => shapeToolType,
        setIcon: (iconData) => {
          activeIconDataRef.current = iconData;
          // MW - Cache the icon's aspect ratio (height / width) for the
          // drag-to-size gesture so tap- and drag-placed icons stay undistorted.
          const vb = iconData?.iconViewBox;
          if (vb && vb.width > 0 && vb.height > 0) {
            activeIconAspect.value = vb.height / vb.width;
          } else {
            activeIconAspect.value = 1;
          }
          setShapeToolType('icon');
          // MW - If a shape is already selected and we're in shape mode, update
          // it to the new icon immediately.
          if (currentTool === 'shape' && selectedShapeId.value != null) {
            const shapeId = selectedShapeId.value;
            const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
            if (shapeIndex !== -1) {
              pushHistory(buildSnapshot(shapes.value));
              const existing = shapes.value[shapeIndex];
              // MW - Convert circle to rect-like bounds if needed.
              let base = existing;
              if (existing.type === 'circle') {
                const r = existing.radius ?? 0;
                base = {
                  ...existing,
                  x: existing.x - r,
                  y: existing.y - r,
                  width: r * 2,
                  height: r * 2,
                  radius: undefined,
                };
              }
              let updatedShape = {
                ...base,
                type: 'icon',
                iconName: iconData.iconName ?? '',
                iconPath: iconData.iconPath ?? '',
                iconViewBox: iconData.iconViewBox ?? {
                  width: 512,
                  height: 512,
                },
              };
              // MW - Always recalculate height from the new viewbox ratio so the
              // icon is never distorted (e.g. swapping a tall icon for a square one).
              if (updatedShape.iconViewBox) {
                const vbW = updatedShape.iconViewBox.width;
                const vbH = updatedShape.iconViewBox.height;
                if (vbW > 0 && vbH > 0) {
                  updatedShape = {
                    ...updatedShape,
                    height: updatedShape.width * (vbH / vbW),
                  };
                }
              }
              const updatedShapes = [...shapes.value];
              updatedShapes[shapeIndex] = updatedShape;
              shapes.value = updatedShapes;
              setShapeList(updatedShapes);
              // MW - Sync selection outline to the corrected bounds.
              selectedShapeBounds.value = {
                x: updatedShape.x,
                y: updatedShape.y,
                width: updatedShape.width,
                height: updatedShape.height,
              };
              notifyChange(shapes);
              notifyChange(selectedShapeBounds);
            }
          }
        },
        undo,
        redo,
        canUndo,
        canRedo,
        clearSelection: () => clearSelection(),
        // MW - Layer management
        getLayers: () => layers.map((l) => ({ ...l })),
        addLayer,
        duplicateLayer,
        duplicateSelectedLayer: (name) => duplicateLayer(undefined, name),
        removeLayer,
        setActiveLayer: (layerId) => setActiveLayerId(layerId),
        getActiveLayer: () => activeLayerIdRef.current,
        moveShapeToLayer: (layerId, id) => moveShapeToLayer(id, layerId),
        moveLayerUp,
        moveLayerDown,
        // MW - Shape z-order within a layer; default to selected shape when no id given
        bringShapeForward: (id) =>
          bringShapeForward(id ?? selectedShapeId.value),
        sendShapeBackward: (id) =>
          sendShapeBackward(id ?? selectedShapeId.value),
        bringShapeToFront: (id) =>
          bringShapeToFront(id ?? selectedShapeId.value),
        sendShapeToBack: (id) => sendShapeToBack(id ?? selectedShapeId.value),
        // MW - Grid / ruler toggles
        setGridVisible: (visible) => setShowGrid(visible),
        isGridVisible: () => showGrid,
        toggleGrid: () => setShowGrid((v) => !v),
        setRulerVisible: (visible) => setShowRuler(visible),
        isRulerVisible: () => showRuler,
        toggleRuler: () => setShowRuler((v) => !v),
        setRulerUnit: (unit) => setRulerUnit(unit),
        getRulerUnit: () => rulerUnit,
      }),
      [
        currentTool,
        currentColour,
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        clearCanvas,
        setColour,
        setBrushSize,
        setFontSize,
        convertAllStrokesToShape,
        saveCanvasAsImage,
        buildSnapshot,
        pushHistory,
        deletedSelectedShape,
        duplicateSelectedShape,
        clearSelection,
        closeKeyboard,
        activeStrokeThickness,
        activeFontSize,
        activeIconAspect,
        shapeToolType,
        setText,
        undo,
        redo,
        canUndo,
        canRedo,
        layers,
        addLayer,
        duplicateLayer,
        removeLayer,
        moveShapeToLayer,
        moveLayerUp,
        moveLayerDown,
        bringShapeForward,
        sendShapeBackward,
        bringShapeToFront,
        sendShapeToBack,
        serializeCanvas,
        loadCanvas,
        showGrid,
        showRuler,
        rulerUnit,
      ]
    );

    return (
      <GestureHandlerRootView style={styles.root}>
        {active ? (
          <GestureDetector gesture={activeGestures}>
            <View
              style={styles.container}
              onLayout={() => setCanvasReady(true)}
            >
              <Canvas style={canvasStyle}>
                <Group matrix={viewportMatrix}>
                  {
                    // MW - Below is the paperRect with a white background and a shadow.
                  }
                  <Box box={paperRect} color="white">
                    <BoxShadow
                      dx={0}
                      dy={2}
                      blur={4}
                      color="rgba(0,0,0,0.65)"
                    />
                    <BoxShadow
                      dx={0}
                      dy={12}
                      blur={24}
                      color="rgba(0,0,0,0.08)"
                    />
                  </Box>
                  {/* MW - Ruler bars sit outside the clip so they extend into
                    the grey canvas margin and are never cropped by the paper. */}
                  <RulerOverlay
                    canvasWidth={resolvedCanvas.width}
                    canvasHeight={resolvedCanvas.height}
                    visible={showRuler}
                    unit={rulerUnit}
                  />
                  {
                    // MW - Below is the drawing area of the canvas - anything inside of the Group with the clip will be clipped to the paperRect.
                  }
                  <Group clip={paperRect}>
                    {/* MW - Grid overlay. Rendered first so it sits behind all
                      strokes and shapes. Clipped to the paper boundary. */}
                    <GridOverlay
                      canvasWidth={resolvedCanvas.width}
                      canvasHeight={resolvedCanvas.height}
                      visible={showGrid}
                    />
                    {backgroundImage && (
                      <Image
                        image={backgroundImage}
                        x={0}
                        y={0}
                        width={resolvedCanvas.width}
                        height={resolvedCanvas.height}
                        fit="fill"
                      />
                    )}
                    {/* MW - Render layers in order (bottom index → back,
                      top index → front). Background image is always beneath
                      all layers. The drawing layer gets an isolated offscreen
                      buffer so the eraser blendMode works correctly without
                      affecting shapes or text on other layers. */}
                    {layers
                      .filter((layer) => layer.id !== 'drawing')
                      .map((layer) => (
                        <Group key={layer.id}>
                          {shapeList
                            .filter((s) => getShapeLayer(s) === layer.id)
                            .map((shapeSnapshot) => (
                              <ShapeNode
                                key={shapeSnapshot.id}
                                shapeID={shapeSnapshot.id}
                                shapes={shapes}
                                shapeSnapshot={shapeSnapshot}
                              />
                            ))}
                        </Group>
                      ))}
                    <Group key="drawing" layer={<Paint />}>
                      {allStrokesPath.map((stroke, index) =>
                        stroke.isFilled ? (
                          <Path
                            key={index}
                            path={stroke.path}
                            color={stroke.colour}
                            style="fill"
                            blendMode="srcOver"
                          />
                        ) : (
                          <Path
                            key={index}
                            path={stroke.path}
                            color={stroke.colour}
                            style="stroke"
                            strokeWidth={stroke.thickness || 8}
                            strokeCap={
                              stroke.isHighlighter ? 'square' : 'round'
                            }
                            strokeJoin={
                              stroke.isHighlighter ? 'miter' : 'round'
                            }
                            blendMode={stroke.isEraser ? 'clear' : 'srcOver'}
                          />
                        )
                      )}
                      {/* MW - Eraser clear pass. Kept INSIDE the drawing
                          layer's offscreen buffer so its `clear` blendMode
                          erases committed paint without punching through to
                          the shapes/background beneath. A separate visual
                          preview is rendered on top of every layer below. */}
                      {currentTool === 'eraser' && (
                        <Path
                          path={activeStrokePath}
                          color={activeStrokeRenderColour}
                          style="stroke"
                          strokeWidth={activeStrokeThickness}
                          strokeCap="round"
                          strokeJoin="round"
                          blendMode="clear"
                        />
                      )}
                    </Group>
                    {(currentTool === 'paint' ||
                      currentTool === 'highlighter' ||
                      currentTool === 'eraser') && (
                      <Path
                        path={activeStrokePath}
                        color={
                          currentTool === 'eraser'
                            ? 'rgba(0,0,0,0.35)'
                            : activeStrokeRenderColour
                        }
                        style="stroke"
                        strokeWidth={activeStrokeThickness}
                        strokeCap={
                          currentTool === 'highlighter' ? 'square' : 'round'
                        }
                        strokeJoin={
                          currentTool === 'highlighter' ? 'miter' : 'round'
                        }
                      />
                    )}
                    {/* MW - Two-tap line placement anchor marker. */}
                    <Circle
                      cx={pendingMarkerCx}
                      cy={pendingMarkerCy}
                      r={pendingMarkerR}
                      color="#6366f1"
                    />
                    {/* MW - Selection outline. Always on top of all layers;
                      driven entirely on the UI thread via derived values.
                      Width/height are 0 when nothing is selected. */}
                    <SelectionOutline
                      origin={selectionOrigin}
                      transform={selectionTransform}
                      x={selectionX}
                      y={selectionY}
                      width={selectionWidth}
                      height={selectionHeight}
                    />
                  </Group>
                </Group>
              </Canvas>
              <LoadingOverlay visible={!canvasReady} />
            </View>
          </GestureDetector>
        ) : null}
        <TextEditingModal
          visible={active && editorVisible}
          mode={editorMode}
          value={editorValue}
          onChangeText={onEditorChange}
          onSubmit={submitEditor}
          onCancel={cancelEditor}
          {...(textModalProps ?? {})}
        />
      </GestureHandlerRootView>
    );
  }
);

export default SkiaIllustrator;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dfdfdf',
  },
});

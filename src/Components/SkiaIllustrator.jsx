// Core Imports
import React, { useMemo, useEffect, useLayoutEffect, useState } from 'react';

// React Native Imports
import { StyleSheet, View, useWindowDimensions, Keyboard } from 'react-native';

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
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';

// Skia Imports
import {
  Skia,
  Image,
  Canvas,
  Group,
  Path,
  Paint,
  Rect,
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
import TextEditingOverlay from './TextEditingOverlay';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useTextEditing } from '../hooks/useTextEditing';
import {
  getShapeLayer,
  getShapeAABB,
  buildFlattenedPath,
  PAPER_SIZE,
} from '../utils/shapeUtils';

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

    const initialX = (windowWidth - resolvedCanvas.width) / 2;
    const initialY = (windowHeight - resolvedCanvas.height) / 2;

    // MW - View port states.
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(initialX);
    const translateY = useSharedValue(initialY);
    const savedTranslateX = useSharedValue(initialX);
    const savedTranslateY = useSharedValue(initialY);

    // MW - Selection states.
    const selectedShapeBounds = useSharedValue(null);
    const selectedShapeRotation = useSharedValue(0);

    const selectedShapeId = useSharedValue(null);
    const selectedShapeStart = useSharedValue({ x: 0, y: 0 });
    const pinchStartDimensions = useSharedValue({
      width: 0,
      height: 0,
      radius: 0,
    });
    const mountedShapeIds = useSharedValue([]);

    // MW - Paint states.
    const shapes = useSharedValue([]);

    const [shapeList, setShapeList] = useState(() => shapes.value);
    const [shapeToolType, setShapeToolType] = useState('square');
    const [canvasReady, setCanvasReady] = useState(false);

    // MW - Ruler & grid visibility + unit
    const [showGrid, setShowGrid] = useState(_showGrid);
    const [showRuler, setShowRuler] = useState(_showRuler);
    const [rulerUnit, setRulerUnit] = useState('px'); // 'px' | 'cm'

    const activeIconDataRef = React.useRef(null);

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
      historySize,
      canUndo,
      canRedo,
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

    // MW - rest timer
    const resetTimer = React.useRef(null);

    // MW - Function to add the current active stroke path to the list of all strokes and reset the active stroke path after a short delay.
    const addPathToAllStrokes = React.useCallback(
      (path, colour, thickness = 8, isEraser = false) => {
        // MW - Snapshot before this stroke is committed.
        pushHistory(buildSnapshot(shapes.value));

        // MW - When erasing: detect shapes whose AABB overlaps the eraser and flatten em :)

        const flattenedStrokes = [];
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
            if (!overlaps) continue;

            let flatPath;
            if (shape.type === 'circle') {
              flatPath = Skia.Path.Make();
              flatPath.addCircle(shape.x, shape.y, shape.radius ?? 10);
            } else {
              const svgStr = buildFlattenedPath(shape);
              flatPath =
                Skia.Path.MakeFromSVGString(svgStr) ?? Skia.Path.Make();
            }
            const strokeStyleTypes = ['line', 'arrow', 'cross', 'check'];
            flattenedStrokes.push({
              path: flatPath,
              colour: shape.colour ?? 'black',
              isEraser: false,
              thickness: 2,
              isFilled: !strokeStyleTypes.includes(shape.type),
            });
            hitIds.push(shape.id);
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
              notifySelectedShapeChange(null);
            }
          }
        }

        // Add flattened shapes + eraser stroke in one update to guarantee order.
        setAllStrokesPath((prev) => [
          ...prev,
          ...flattenedStrokes,
          { path, colour, isEraser, thickness },
        ]);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => {
          activeStrokePath.value = Skia.Path.Make();
          notifyChange(activeStrokePath);
          resetTimer.current = null;
        }, 200);
      },
      [
        activeStrokePath,
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

    // MW - Cancel a queued active-stroke reset. Called when a new stroke
    // starts so the previous stroke's delayed timer can't wipe the fresh
    // path mid-draw (which caused a stray line from the canvas origin).
    const cancelPendingReset = React.useCallback(() => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }
    }, []);

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

      const currentScale = scale.value || 1;
      const newX = (windowWidth - targetWidth * currentScale) / 2;
      const newY = (windowHeight - targetHeight * currentScale) / 2;
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
      scale,
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
    }, []);

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
          selectedShapeId,
          selectedShapeStart,
          selectedShapeBounds,
          selectedShapeRotation,
          pinchStartDimensions,
          shapes,
          onSelectedShapeChange: notifySelectedShapeChange,
          onBeforeShapeMutation,
        }),
      [
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
          activeStrokePath,
          activeStrokeColour,
          activeStrokeThickness,
          addPathToAllStrokes,
          cancelPendingReset,
        }),
      [
        currentTool,
        scale,
        translateX,
        translateY,
        activeStrokePath,
        activeStrokeColour,
        activeStrokeThickness,
        addPathToAllStrokes,
        cancelPendingReset,
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
      },
      [pushHistory, buildSnapshot, shapes]
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
            shapes,
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
          shapes,
          notifySelectedShapeChange,
          onBeforeShapeMutation,
        ]
      );

    const { tapPlaceShapeGesture } = useMemo(
      () =>
        createShapeGestures({
          currentTool,
          shapeToolType,
          shapes,
          addShape,
          onSelectedShapeChange: notifySelectedShapeChange,
          scale,
          translateX,
          translateY,
          activeStrokePath,
          activeStrokeColour,
          activeStrokeThickness,
          addPathToAllStrokes,
          cancelPendingReset,
          selectedShapeId,
          selectedShapeStart,
          selectedShapeBounds,
          selectedShapeRotation,
        }),
      [
        shapes,
        addShape,
        currentTool,
        shapeToolType,
        scale,
        translateX,
        translateY,
        activeStrokePath,
        activeStrokeColour,
        activeStrokeThickness,
        addPathToAllStrokes,
        cancelPendingReset,
        selectedShapeId,
        selectedShapeStart,
        selectedShapeBounds,
        selectedShapeRotation,
        notifySelectedShapeChange,
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

    // MW - Text editing: state, keyboard handling, addText/startTextEdit
    // callbacks, and the two gesture recognisers are all owned here.
    const {
      editingTextId,
      editingContent,
      editingScreenPos,
      editingTextIdShared,
      addText,
      commitTextEdit,
      onEditingTextChange,
      doubleTapTextGesture,
      dismissKeyboardGesture,
    } = useTextEditing({
      shapes,
      setShapeList,
      scale,
      translateX,
      translateY,
      savedTranslateY,
      activeFontSize,
      activeStrokeColour,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
      pushHistory,
      buildSnapshot,
      windowHeight,
    });

    const { placeTextGesture } = useMemo(
      () =>
        createTextGestures({
          currentTool,
          scale,
          translateX,
          translateY,
          selectedShapeId,
          selectedShapeStart,
          selectedShapeBounds,
          selectedShapeRotation,
          shapes,
          onSelectedShapeChange: notifySelectedShapeChange,
          addText,
        }),
      [
        currentTool,
        scale,
        translateX,
        translateY,
        selectedShapeId,
        selectedShapeStart,
        selectedShapeBounds,
        selectedShapeRotation,
        shapes,
        notifySelectedShapeChange,
        addText,
      ]
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
            doubleTapTextGesture,
            dismissKeyboardGesture
          );
        case 'selection':
          return Gesture.Simultaneous(
            panSelectionGesture,
            rotateSelectionGesture,
            tapSelectionGesture,
            pinchResizeGesture,
            doubleTapTextGesture,
            dismissKeyboardGesture
          );
        case 'paint':
        case 'eraser':
          return Gesture.Simultaneous(paintGesture, dismissKeyboardGesture);
        case 'shape':
          // MW - While in shape mode a selected shape can still be moved or
          // rotated without switching tools.
          return Gesture.Simultaneous(
            tapPlaceShapeGesture,
            panSelectionGesture,
            rotateSelectionGesture,
            pinchResizeGesture,
            doubleTapTextGesture,
            dismissKeyboardGesture
          );
        case 'text':
          return Gesture.Simultaneous(
            placeTextGesture,
            panSelectionGesture,
            rotateSelectionGesture,
            pinchResizeGesture,
            doubleTapTextGesture,
            dismissKeyboardGesture
          );
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
      doubleTapTextGesture,
      dismissKeyboardGesture,
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

    const setColour = (colour) => {
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
    };

    const setBrushSize = (size) => {
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
    };

    const setFontSize = (size) => {
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
    };

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
        isFilled: stroke.isFilled ?? false,
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
        const data =
          typeof input === 'string' ? JSON.parse(input) : input;

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
          isFilled: s.isFilled ?? false,
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

    const saveCanvasAsImage = async () => {
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
      // always beneath all layers and has already been drawn above.
      layers.forEach((layer) => {
        if (layer.id === 'drawing') {
          // MW - saveLayer creates an isolated offscreen compositing buffer.
          // BlendMode.Clear on eraser strokes only erases within this buffer,
          // so the background image pixels remain untouched.
          canvas.saveLayer();
          allStrokesPath.forEach((stroke) => {
            const { path, colour, thickness, isEraser, isFilled } = stroke;
            const paint = Skia.Paint();
            paint.setColor(Skia.Color(colour ?? 'black'));
            if (isFilled) {
              paint.setStyle(PaintStyle.Fill);
            } else {
              paint.setStyle(PaintStyle.Stroke);
              paint.setStrokeWidth(thickness ?? 8);
              paint.setStrokeCap(StrokeCap.Round);
              paint.setStrokeJoin(StrokeJoin.Round);
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
                if (iconSvgPath) {
                  const vbW = shape.iconViewBox?.width ?? 512;
                  const vbH = shape.iconViewBox?.height ?? 512;
                  canvas.save();
                  canvas.rotate(rotation ?? 0, x + w / 2, y + h / 2);
                  canvas.translate(x, y);
                  canvas.scale(w / vbW, h / vbH);
                  paint.setStyle(PaintStyle.Fill);
                  canvas.drawPath(iconSvgPath, paint);
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
              if (strokeStyleTypes.includes(type)) {
                paint.setStyle(PaintStyle.Stroke);
                paint.setStrokeWidth(2);
                paint.setStrokeCap(StrokeCap.Round);
                paint.setStrokeJoin(StrokeJoin.Round);
              } else {
                paint.setStyle(PaintStyle.Fill);
              }
              canvas.drawPath(skPath, paint);
            });
        }
      });

      surface.flush();

      const imageSnapshot = surface.makeImageSnapshot();
      const base64 = imageSnapshot.encodeToBase64();

      return `data:image/png;base64,${base64}`;
    };

    const closeKeyboard = () => {
      if (editingTextId) {
        commitTextEdit();
      }
      Keyboard.dismiss();
    };

    React.useImperativeHandle(
      ref,
      () => ({
        clearCanvas,
        setCurrentTool,
        getCurrentTool: () => currentTool,
        setColour,
        getCurrentColour: () => currentColour,
        setBrushSize,
        getCurrentBrushSize: () => activeStrokeThickness.value,
        saveCanvasAsImage,
        serializeCanvas,
        loadCanvas,
        setFontSize,
        getCurrentFontSize: () => activeFontSize.value,
        deleteSelectedShape: deletedSelectedShape,
        deletedSelectedShape,
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
                base = { ...existing, x: existing.x - r, y: existing.y - r, width: r * 2, height: r * 2, radius: undefined };
              }
              let updatedShape = {
                ...base,
                type: 'icon',
                iconName: iconData.iconName ?? '',
                iconPath: iconData.iconPath ?? '',
                iconViewBox: iconData.iconViewBox ?? { width: 512, height: 512 },
              };
              // MW - Always recalculate height from the new viewbox ratio so the
              // icon is never distorted (e.g. swapping a tall icon for a square one).
              if (updatedShape.iconViewBox) {
                const vbW = updatedShape.iconViewBox.width;
                const vbH = updatedShape.iconViewBox.height;
                if (vbW > 0 && vbH > 0) {
                  updatedShape = { ...updatedShape, height: updatedShape.width * (vbH / vbW) };
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
        allStrokesPath,
        resolvedCanvas,
        backgroundImage,
        shapes,
        selectedShapeId,
        selectedShapeStart,
        selectedShapeBounds,
        selectedShapeRotation,
        notifySelectedShapeChange,
        addText,
        deletedSelectedShape,
        activeStrokeThickness,
        activeFontSize,
        shapeToolType,
        undo,
        redo,
        historySize,
        layers,
        activeLayerId,
        addLayer,
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
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={activeGestures}>
          <View
            style={styles.container}
            onLayout={() => setCanvasReady(true)}
            onPress={closeKeyboard}
          >
            <Canvas style={{ width: windowWidth, height: windowHeight }}>
              <Group matrix={viewportMatrix}>
                {
                  // MW - Below is the paperRect with a white background and a shadow.
                }
                <Box box={paperRect} color="white">
                  <BoxShadow dx={0} dy={2} blur={4} color="rgba(0,0,0,0.65)" />
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
                  {layers.map((layer) => {
                    if (layer.id === 'drawing') {
                      return (
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
                                strokeCap="round"
                                strokeJoin="round"
                                blendMode={
                                  stroke.isEraser ? 'clear' : 'srcOver'
                                }
                              />
                            )
                          )}
                          {activeStrokePath.value != null && (
                            <Path
                              path={activeStrokePath}
                              color={currentColour}
                              style="stroke"
                              strokeWidth={activeStrokeThickness}
                              strokeCap="round"
                              strokeJoin="round"
                              blendMode={
                                currentTool === 'eraser' ? 'clear' : 'srcOver'
                              }
                            />
                          )}
                        </Group>
                      );
                    }
                    return (
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
                    );
                  })}
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
        <TextEditingOverlay
          editingTextId={editingTextId}
          editingScreenPos={editingScreenPos}
          editingContent={editingContent}
          onChangeText={onEditingTextChange}
          onCommit={commitTextEdit}
        />
      </GestureHandlerRootView>
    );
  }
);

export default SkiaIllustrator;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dfdfdf',
  },
});

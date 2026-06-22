// Core Imports
import React, { useMemo, useEffect, useState } from 'react';

// React Native Imports
import {
  StyleSheet,
  View,
  useWindowDimensions,
  TextInput,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';

// Gesture Handler Imports
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

// Gesture Imports
import { createViewportGestures } from '../Gestures/viewportGestures';
import { createSelectionGestures } from '../Gestures/selectionGestures';
import { createPaintGestures } from '../Gestures/paintGestures';
import { createTextGestures } from '../Gestures/textGestures';
import { createShapeGestures } from '../Gestures/shapeGesture';
import { createControlGestures } from '../Gestures/controlGestures';

// Reanimated Imports
import {
  useSharedValue,
  useDerivedValue,
  runOnJS,
} from 'react-native-reanimated';

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
  rrect,
  rect,
  notifyChange,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
  BlendMode,
  DashPathEffect,
} from '@shopify/react-native-skia';

// MW - Wrapper Component for the canvas that handles gestures and renders shapes.
import { ShapeNode, getSharedTypeface, measureText } from './ShapeNode';

const PAPER_SIZE = { width: 200, height: 200 };

const SkiaIllustrator = React.forwardRef(
  (
    {
      canvasWidth = PAPER_SIZE.width,
      canvasHeight = PAPER_SIZE.height,
      imageSource = null,
      onToolChange = null,
      onSelectedShapeChange = null,
    },
    ref
  ) => {
    2;
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();

    // MW - Tool States
    const [currentTool, setCurrentTool] = React.useState('control');
    const [currentColour, setCurrentColour] = React.useState('black');

    // MW - Notify the parent whenever the active tool changes (e.g. the text
    // tool auto-switches back to 'selection' after placing text) so external
    // UI like a toolbar can stay in sync.
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

    // MW - Paint states.
    const shapes = useSharedValue([]);

    const [shapeList, setShapeList] = useState(() => shapes.value);
    const [shapeToolType, setShapeToolType] = useState('square');

    const [allStrokesPath, setAllStrokesPath] = useState([]);

    // MW - Text editing state.
    const [editingTextId, setEditingTextId] = useState(null);
    const [editingContent, setEditingContent] = useState('');
    const [editingScreenPos, setEditingScreenPos] = useState({
      x: 0,
      y: 0,
      fontSize: 32,
      colour: 'black',
    });
    // MW - Refs kept in sync with the screen-position state so the keyboard
    // listener can read the latest value without stale-closure issues.
    const editingScreenPosRef = React.useRef({ x: 0, y: 0, fontSize: 32, colour: 'black' });
    const hasAdjustedForKeyboard = React.useRef(false);
    const priorTranslateYRef = React.useRef(null);

    // MW - Undo/redo stacks. Stored in refs to avoid re-renders on every
    // mutation; historySize is the React state that drives canUndo/canRedo.
    const undoStack = React.useRef([]);
    const redoStack = React.useRef([]);
    const MAX_HISTORY = 50;
    const [historySize, setHistorySize] = React.useState({ undo: 0, redo: 0 });

    // MW - Ref mirror of allStrokesPath so buildSnapshot doesn't need it as a
    // dependency — otherwise every new stroke would recreate gesture factories.
    const allStrokesRef = React.useRef(allStrokesPath);
    useEffect(() => {
      allStrokesRef.current = allStrokesPath;
    }, [allStrokesPath]);

    // MW - Serialise the current canvas state into a plain-JS snapshot. Skia
    // Path objects become SVG strings; shape objects are shallow-cloned.
    // Accepts shapesArray explicitly so callers can pass a pre-mutation copy.
    const buildSnapshot = React.useCallback(
      (shapesArray) => ({
        shapes: shapesArray.map((s) => ({ ...s })),
        strokes: allStrokesRef.current.map(
          ({ path, colour, thickness, isEraser }) => ({
            pathSVG: path.toSVGString(),
            colour,
            thickness,
            isEraser,
          })
        ),
      }),
      []
    );

    // MW - Push snapshot onto undo stack and clear redo (new branch invalidates
    // any existing redo history). Caps the stack at MAX_HISTORY entries.
    const pushHistory = React.useCallback((snapshot) => {
      undoStack.current.push(snapshot);
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      setHistorySize({ undo: undoStack.current.length, redo: 0 });
    }, []);

    const notifySelectedShapeChange = React.useCallback(
      (shapeId) => {
        onSelectedShapeChange?.(shapeId != null);
      },
      [onSelectedShapeChange]
    );

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
        // MW - Snapshot before this stroke is committed. allStrokesRef.current
        // still holds the old strokes at this point (the useEffect mirror runs
        // after the state update, not before).
        pushHistory(buildSnapshot(shapes.value));
        setAllStrokesPath((prev) => [
          ...prev,
          { path, colour, isEraser, thickness },
        ]);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => {
          activeStrokePath.value = Skia.Path.Make();
          notifyChange(activeStrokePath);
          resetTimer.current = null;
        }, 200);
      },
      [activeStrokePath, pushHistory, buildSnapshot, shapes]
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

    // MW - Deserialise a snapshot and restore the canvas. SVG strings are
    // reconstructed into live Skia Paths; shape objects are cloned fresh.
    // The active selection is dropped because the previously-selected shape
    // may not exist in the restored state.
    const restoreSnapshot = React.useCallback(
      (snapshot) => {
        const restoredStrokes = snapshot.strokes.map(
          ({ pathSVG, colour, thickness, isEraser }) => ({
            path: Skia.Path.MakeFromSVGString(pathSVG) ?? Skia.Path.Make(),
            colour,
            thickness,
            isEraser,
          })
        );
        const clonedShapes = snapshot.shapes.map((s) => ({ ...s }));
        shapes.value = clonedShapes;
        setShapeList(clonedShapes);
        notifyChange(shapes);
        setAllStrokesPath(restoredStrokes);
        selectedShapeId.value = null;
        selectedShapeBounds.value = null;
        selectedShapeRotation.value = 0;
        notifySelectedShapeChange(null);
      },
      [
        shapes,
        selectedShapeId,
        selectedShapeBounds,
        selectedShapeRotation,
        notifySelectedShapeChange,
      ]
    );

    const undo = React.useCallback(() => {
      if (!undoStack.current.length) return;
      redoStack.current.push(buildSnapshot(shapes.value));
      restoreSnapshot(undoStack.current.pop());
      setHistorySize({
        undo: undoStack.current.length,
        redo: redoStack.current.length,
      });
    }, [buildSnapshot, restoreSnapshot, shapes]);

    const redo = React.useCallback(() => {
      if (!redoStack.current.length) return;
      undoStack.current.push(buildSnapshot(shapes.value));
      restoreSnapshot(redoStack.current.pop());
      setHistorySize({
        undo: undoStack.current.length,
        redo: redoStack.current.length,
      });
    }, [buildSnapshot, restoreSnapshot, shapes]);

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

    useEffect(() => {
      let targetWidth = canvasWidth;
      let targetHeight = canvasHeight;

      if (backgroundImage) {
        const imageWidth = backgroundImage.width();
        const imageHeight = backgroundImage.height();
        1;
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

    const { panViewportGesture, pinchViewportGesture } = useMemo(
      () =>
        createViewportGestures({
          currentTool,
          scale,
          savedScale,
          translateX,
          translateY,
          savedTranslateX,
          savedTranslateY,
          windowHeight,
          windowWidth,
          canvasWidth: resolvedCanvas.width,
          canvasHeight: resolvedCanvas.height,
        }),
      [
        currentTool,
        scale,
        savedScale,
        translateX,
        translateY,
        savedTranslateX,
        savedTranslateY,
        resolvedCanvas.width,
        resolvedCanvas.height,
        windowHeight,
        windowWidth,
      ]
    );

    const { panSelectionGesture, rotateSelectionGesture, tapSelectionGesture } =
      useMemo(
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
        // MW - shapes.value already contains the new shape when this JS callback
        // runs (it was added on the UI thread first). Exclude it to capture the
        // pre-add state for undo.
        pushHistory(
          buildSnapshot(shapes.value.filter((s) => s.id !== shape.id))
        );
        setShapeList((prev) => [...prev, shape]);
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
    // needs Skia + the cached typeface (which live on the JS thread), so the
    // text placement gesture hands the canvas-space point here via runOnJS. The
    // measured width/height are stored on the shape so every hit-test, selection
    // box and rotation pivot uses exact glyph bounds instead of an estimate.
    const addText = React.useCallback(
      (x, y) => {
        if (selectedShapeId.value) {
          selectedShapeId.value = null;
          selectedShapeBounds.value = null;
          selectedShapeStart.value = { x: 0, y: 0 };
          selectedShapeRotation.value = 0;
          notifyChange(selectedShapeId);
          notifyChange(selectedShapeBounds);
          notifyChange(selectedShapeRotation);
          notifyChange(selectedShapeId);
          notifySelectedShapeChange(null);
          return;
        }

        const fontSizeValue = activeFontSize.value ?? 32;
        const content = 'New Text';
        pushHistory(buildSnapshot(shapes.value));
        const { width: textWidth, height: textHeight } = measureText(
          content,
          fontSizeValue
        );

        const newShape = {
          id: Date.now().toString(),
          type: 'text',
          x,
          y,
          width: textWidth,
          height: textHeight,
          rotation: 0,
          colour: activeStrokeColour.value,
          content,
          fontSize: fontSizeValue,
        };

        const nextShapes = [...shapes.value, newShape];
        shapes.value = nextShapes;
        setShapeList(nextShapes);
        selectedShapeId.value = newShape.id;
        selectedShapeStart.value = { x, y };
        selectedShapeBounds.value = {
          x,
          y: y - textHeight,
          width: textWidth,
          height: textHeight,
        };
        selectedShapeRotation.value = 0;
        notifyChange(shapes);
        notifySelectedShapeChange(newShape.id);
      },
      [
        activeFontSize,
        activeStrokeColour,
        shapes,
        selectedShapeId,
        selectedShapeStart,
        selectedShapeBounds,
        selectedShapeRotation,
        notifySelectedShapeChange,
        pushHistory,
        buildSnapshot,
      ]
    );

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

    // MW - Open the inline text editor for an existing text shape. Called via
    // runOnJS from the double-tap worklet so Skia / React state access stays on
    // the JS thread.
    const startTextEdit = React.useCallback(
      (shapeId) => {
        const shape = shapes.value.find((s) => s.id === shapeId);
        if (!shape || shape.type !== 'text') return;

        // Snapshot before any edits so the whole session is one undo step.
        pushHistory(buildSnapshot(shapes.value));

        const currentScale = scale.value;
        const tx = translateX.value;
        const ty = translateY.value;

        // Convert canvas baseline to screen space.
        const screenX = shape.x * currentScale + tx;
        const screenY = shape.y * currentScale + ty;
        const screenFontSize = (shape.fontSize ?? 32) * currentScale;
        const pos = {
          x: screenX,
          y: screenY,
          fontSize: screenFontSize,
          colour: shape.colour ?? 'black',
        };

        editingScreenPosRef.current = pos;
        hasAdjustedForKeyboard.current = false;
        priorTranslateYRef.current = null;

        setEditingTextId(shapeId);
        setEditingContent(shape.content ?? '');
        setEditingScreenPos(pos);

        // Select the shape so the selection outline stays visible.
        const h = shape.height ?? shape.fontSize ?? 32;
        selectedShapeId.value = shapeId;
        selectedShapeBounds.value = {
          x: shape.x,
          y: shape.y - h,
          width: shape.width ?? 0,
          height: h,
        };
        selectedShapeRotation.value = shape.rotation ?? 0;
        notifyChange(selectedShapeId);
        notifyChange(selectedShapeBounds);
        notifyChange(selectedShapeRotation);
        notifySelectedShapeChange(shapeId);
      },
      [
        shapes,
        scale,
        translateX,
        translateY,
        selectedShapeId,
        selectedShapeBounds,
        selectedShapeRotation,
        notifySelectedShapeChange,
        pushHistory,
        buildSnapshot,
      ]
    );

    // MW - Live-update the text shape content as the user types so the canvas
    // stays in sync without waiting for the editor to close.
    const onEditingTextChange = React.useCallback(
      (text) => {
        setEditingContent(text);

        const shapeIndex = shapes.value.findIndex((s) => s.id === editingTextId);
        if (shapeIndex === -1) return;

        const shape = shapes.value[shapeIndex];
        const { width: textWidth, height: textHeight } = measureText(
          text || ' ',
          shape.fontSize ?? 32
        );

        const updatedShape = {
          ...shape,
          content: text,
          width: textWidth,
          height: textHeight,
        };
        const updatedShapes = [...shapes.value];
        updatedShapes[shapeIndex] = updatedShape;
        shapes.value = updatedShapes;
        setShapeList(updatedShapes);
        notifyChange(shapes);

        selectedShapeBounds.value = {
          x: updatedShape.x,
          y: updatedShape.y - textHeight,
          width: textWidth,
          height: textHeight,
        };
        notifyChange(selectedShapeBounds);
      },
      [editingTextId, shapes, selectedShapeBounds]
    );

    // MW - Finalise editing: hide the overlay and restore any viewport shift
    // that was applied to keep the text above the keyboard.
    const commitTextEdit = React.useCallback(() => {
      if (priorTranslateYRef.current !== null) {
        translateY.value = priorTranslateYRef.current;
        savedTranslateY.value = priorTranslateYRef.current;
        priorTranslateYRef.current = null;
      }
      setEditingTextId(null);
      Keyboard.dismiss();
    }, [translateY, savedTranslateY]);

    // MW - Double-tap on any text shape to open the inline editor. Defined
    // here (not in a gesture factory) so it can call startTextEdit directly via
    // runOnJS without threading the callback through every gesture file.
    const doubleTapTextGesture = useMemo(
      () =>
        Gesture.Tap()
          .numberOfTaps(2)
          .onStart((event) => {
            'worklet';
            const currentScale = scale.value || 1;
            const tx = translateX.value || 0;
            const ty = translateY.value || 0;
            const cx = (event.x - tx) / currentScale;
            const cy = (event.y - ty) / currentScale;

            const currentShapes = shapes.value;
            for (let i = currentShapes.length - 1; i >= 0; i--) {
              const shape = currentShapes[i];
              if (shape.type !== 'text') continue;

              const w = shape.width ?? 0;
              const h = shape.height ?? shape.fontSize ?? 32;
              const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
              const shapeCx = shape.x + w / 2;
              const shapeCy = shape.y - h / 2;
              const ddx = cx - shapeCx;
              const ddy = cy - shapeCy;
              const cosA = Math.cos(-rot);
              const sinA = Math.sin(-rot);
              const rx = ddx * cosA - ddy * sinA + shapeCx;
              const ry = ddx * sinA + ddy * cosA + shapeCy;

              if (
                rx >= shape.x &&
                rx <= shape.x + w &&
                ry >= shape.y - h &&
                ry <= shape.y
              ) {
                runOnJS(startTextEdit)(shape.id);
                return;
              }
            }
          }),
      [scale, translateX, translateY, shapes, startTextEdit]
    );

    // MW - Combined Move Tool Gestures (Pan + Pinch)
    const moveGestures = useMemo(
      () => Gesture.Simultaneous(panViewportGesture, pinchViewportGesture),
      [panViewportGesture, pinchViewportGesture]
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
            doubleTapTextGesture
          );
        case 'paint':
        case 'eraser':
          return paintGesture;
        case 'shape':
          // MW - While in shape mode a selected shape can still be moved or
          // rotated without switching tools.
          return Gesture.Simultaneous(
            tapPlaceShapeGesture,
            panSelectionGesture,
            rotateSelectionGesture,
            doubleTapTextGesture
          );
        case 'text':
          return Gesture.Simultaneous(
            placeTextGesture,
            panSelectionGesture,
            rotateSelectionGesture,
            doubleTapTextGesture
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
    ]);

    const paperRect = rect(0, 0, resolvedCanvas.width, resolvedCanvas.height);

    // MW - Selection outline. Driven by derived values so the box repaints on
    // the UI thread when the gesture mutates selectedShapeBounds (reading
    // `.value` directly in JSX would NOT trigger a React re-render). Width and
    // height collapse to 0 when nothing is selected, so the outline simply
    // disappears. The outline is inset by a 5px offset on every side and its
    // width is capped at 90% of the canvas width. Origin + transform mirror
    // ShapeNode so the box rotates with the selected shape.
    const SELECTION_OFFSET = 5;
    const maxSelectionWidth = resolvedCanvas.width * 0.9;
    const selectionX = useDerivedValue(
      () => (selectedShapeBounds.value?.x ?? 0) - SELECTION_OFFSET
    );
    const selectionY = useDerivedValue(
      () => (selectedShapeBounds.value?.y ?? 0) - SELECTION_OFFSET
    );
    const selectionWidth = useDerivedValue(() => {
      const w = selectedShapeBounds.value?.width ?? 0;
      if (w === 0) return 0;
      return Math.min(w, maxSelectionWidth) + SELECTION_OFFSET * 2;
    });
    const selectionHeight = useDerivedValue(() => {
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

    // MW - When the keyboard appears during text editing, shift the viewport so
    // the edited text stays visible above the keyboard. Restore the shift when
    // editing ends (commitTextEdit also does this, but the hide listener covers
    // the case where the OS dismisses the keyboard independently).
    useEffect(() => {
      if (!editingTextId) {
        hasAdjustedForKeyboard.current = false;
        return;
      }

      const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
        if (hasAdjustedForKeyboard.current) return;
        hasAdjustedForKeyboard.current = true;

        const keyboardHeight = e.endCoordinates.height;
        const keyboardTop = windowHeight - keyboardHeight;
        // 40 px clearance above the keyboard for the text + cursor.
        const textBottom = editingScreenPosRef.current.y + 20;

        if (textBottom > keyboardTop - 40) {
          const offset = textBottom - (keyboardTop - 40);
          priorTranslateYRef.current = translateY.value;
          translateY.value -= offset;
          savedTranslateY.value = translateY.value;

          const updatedPos = {
            ...editingScreenPosRef.current,
            y: editingScreenPosRef.current.y - offset,
          };
          editingScreenPosRef.current = updatedPos;
          setEditingScreenPos(updatedPos);
        }
      });

      const hideSub = Keyboard.addListener('keyboardDidHide', () => {
        if (priorTranslateYRef.current !== null) {
          translateY.value = priorTranslateYRef.current;
          savedTranslateY.value = priorTranslateYRef.current;
          priorTranslateYRef.current = null;
        }
      });

      return () => {
        showSub.remove();
        hideSub.remove();
      };
    }, [editingTextId, windowHeight, translateY, savedTranslateY]);

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

    const saveCanvasAsImage = async () => {
      const surface = Skia.Surface.MakeOffscreen(
        resolvedCanvas.width,
        resolvedCanvas.height
      );

      if (!surface) {
        throw new Error('Failed to create offscreen surface for saving.');
      }

      const canvas = surface.getCanvas();

      // Draw the background image if it exists
      if (backgroundImage) {
        canvas.drawImageRect(
          backgroundImage,
          rect(0, 0, backgroundImage.width(), backgroundImage.height()),
          rect(0, 0, resolvedCanvas.width, resolvedCanvas.height),
          Skia.Paint()
        );
      }

      // Draw all shapes (matches the on-screen ShapeNode rendering)
      shapes.value.forEach((shape) => {
        const { x, y, width: w, height: h, colour, rotation, type } = shape;
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(colour));
        paint.setStyle(PaintStyle.Fill);

        if (type === 'circle') {
          // Circles are not rotated on screen.
          canvas.drawCircle(x, y, shape.radius ?? 10, paint);
          return;
        }

        if (type === 'text') {
          const fontSize = shape.fontSize || 32;
          const font = Skia.Font(getSharedTypeface(), fontSize);
          paint.setColor(Skia.Color(colour));
          canvas.drawText(shape.content, x, y, paint, font);
          return;
        }

        // Rectangles rotate around their centre.
        canvas.save();
        canvas.rotate(rotation ?? 0, x + w / 2, y + h / 2);
        canvas.drawRect(rect(x, y, w, h), paint);
        canvas.restore();
      });

      // Draw all committed strokes
      allStrokesPath.forEach((stroke) => {
        const { path, colour, thickness, isEraser } = stroke;
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(colour ?? 'black'));
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(thickness ?? 8);
        paint.setStrokeCap(StrokeCap.Round);
        paint.setStrokeJoin(StrokeJoin.Round);

        if (isEraser) {
          paint.setBlendMode(BlendMode.Clear);
        }

        canvas.drawPath(path, paint);
      });

      surface.flush();

      const imageSnapshot = surface.makeImageSnapshot();
      const base64 = imageSnapshot.encodeToBase64();

      return `data:image/png;base64,${base64}`;
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
        setFontSize,
        getCurrentFontSize: () => activeFontSize.value,
        deleteSelectedShape: deletedSelectedShape,
        deletedSelectedShape,
        hasSelectedShape: () => selectedShapeId.value != null,
        setShape: (type) => setShapeToolType(type),
        getCurrentShape: () => shapeToolType,
        undo,
        redo,
        canUndo: () => undoStack.current.length > 0,
        canRedo: () => redoStack.current.length > 0,
        clearSelection: () => clearSelection(),
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
      ]
    );

    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={activeGestures}>
          <View style={styles.container}>
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
                {
                  // MW - Below is the drawing area of the canvas - anything inside of the Group with the clip will be clipped to the paperRect.
                }
                <Group clip={paperRect}>
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
                  <Group layer={<Paint />}>
                    {allStrokesPath.map((stroke, index) => (
                      <Path
                        key={index}
                        path={stroke.path}
                        color={stroke.colour}
                        style="stroke"
                        strokeWidth={stroke.thickness || 8}
                        strokeCap="round"
                        strokeJoin="round"
                        blendMode={stroke.isEraser ? 'clear' : 'srcOver'}
                      />
                    ))}
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

                    {/* MW - Selection outline. Always mounted; the derived
                        width/height are 0 when nothing is selected, so it is
                        invisible until a shape is picked. Driven entirely on
                        the UI thread via derived values. */}

                    {shapeList.map((shapeSnapshot) => {
                      const { id } = shapeSnapshot;
                      return (
                        <ShapeNode
                          key={id}
                          shapeID={id}
                          shapes={shapes}
                          shapeSnapshot={shapeSnapshot}
                        />
                      );
                    })}
                    <Group
                      origin={selectionOrigin}
                      transform={selectionTransform}
                    >
                      <Rect
                        x={selectionX}
                        y={selectionY}
                        width={selectionWidth}
                        height={selectionHeight}
                        color="rgba(0,122,255,0.5)"
                        style="stroke"
                        strokeWidth={2}
                      >
                        <DashPathEffect intervals={[8, 6]} />
                      </Rect>
                    </Group>
                  </Group>
                </Group>
              </Group>
            </Canvas>
          </View>
        </GestureDetector>
        {editingTextId != null && (
          <>
            <TouchableWithoutFeedback onPress={commitTextEdit}>
              <View style={StyleSheet.absoluteFill} />
            </TouchableWithoutFeedback>
            <TextInput
              autoFocus
              style={{
                position: 'absolute',
                left: editingScreenPos.x,
                top: editingScreenPos.y - editingScreenPos.fontSize,
                fontSize: editingScreenPos.fontSize,
                color: editingScreenPos.colour,
                padding: 0,
                margin: 0,
                minWidth: 80,
                backgroundColor: 'transparent',
                opacity: 0,
              }}
              value={editingContent}
              onChangeText={onEditingTextChange}
              onBlur={commitTextEdit}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={commitTextEdit}
            />
          </>
        )}
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

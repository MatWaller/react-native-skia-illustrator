import React from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { notifyChange } from '@shopify/react-native-skia';
import { measureText } from '../Components/ShapeNode';

// MW - Owns the text-entry flow. Placing or editing text now opens a themeable
// overlay (TextEditingModal) instead of an invisible inline TextInput:
//   • Tap with the text tool  -> modal opens in 'create' mode; on submit a new
//     text shape is placed at the tapped point.
//   • Double-tap an existing text shape -> modal opens in 'edit' mode; on
//     submit the shape's content is updated and re-measured.
// The modal handles its own keyboard avoidance, so the old viewport-shifting
// and tap-to-dismiss logic has been removed.
export const useTextEditing = ({
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
  defaultTextRef,
}) => {
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [editorMode, setEditorMode] = React.useState('create'); // 'create' | 'edit'
  const [editorValue, setEditorValue] = React.useState('');

  // MW - The shape being edited (edit mode) or the canvas point where a new
  // shape will be placed (create mode). Kept in refs so the submit/cancel
  // callbacks stay stable.
  const editingTextIdRef = React.useRef(null);
  const pendingPointRef = React.useRef({ x: 0, y: 0 });
  // MW - UI-thread mirror so gestures can cheaply skip work while the modal is
  // open (prevents opening a second editor on top of the first).
  const editorOpenShared = useSharedValue(false);

  const closeEditor = React.useCallback(() => {
    editorOpenShared.value = false;
    setEditorVisible(false);
    editingTextIdRef.current = null;
  }, [editorOpenShared]);

  // MW - Open the editor in EDIT mode for an existing text shape.
  const startTextEdit = React.useCallback(
    (shapeId) => {
      const shape = shapes.value.find((s) => s.id === shapeId);
      if (!shape || shape.type !== 'text') return;

      editingTextIdRef.current = shapeId;
      editorOpenShared.value = true;
      setEditorMode('edit');
      setEditorValue(shape.content ?? '');
      setEditorVisible(true);

      // MW - Reflect the selection so the outline tracks the shape while editing.
      const h = shape.height ?? shape.fontSize ?? 32;
      selectedShapeId.value = shapeId;
      selectedShapeStart.value = { x: shape.x, y: shape.y };
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
      editorOpenShared,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
    ]
  );

  // MW - Open the editor in CREATE mode at a canvas-space point. Called via
  // runOnJS from the text placement gesture. The shape is not created until the
  // user submits, so cancelling leaves the canvas untouched.
  const addText = React.useCallback(
    (x, y) => {
      // MW - If a shape is already selected, a tap should just deselect rather
      // than immediately opening the editor (matches the old behaviour).
      if (selectedShapeId.value) {
        selectedShapeId.value = null;
        selectedShapeBounds.value = null;
        selectedShapeStart.value = { x: 0, y: 0 };
        selectedShapeRotation.value = 0;
        notifyChange(selectedShapeId);
        notifyChange(selectedShapeBounds);
        notifyChange(selectedShapeRotation);
        notifySelectedShapeChange(null);
        return;
      }

      pendingPointRef.current = { x, y };
      editingTextIdRef.current = null;
      editorOpenShared.value = true;
      setEditorMode('create');
      setEditorValue((defaultTextRef && defaultTextRef.current) || '');
      setEditorVisible(true);
    },
    [
      editorOpenShared,
      defaultTextRef,
      selectedShapeId,
      selectedShapeBounds,
      selectedShapeStart,
      selectedShapeRotation,
      notifySelectedShapeChange,
    ]
  );

  const onEditorChange = React.useCallback((text) => {
    setEditorValue(text);
  }, []);

  // MW - Commit the modal: create a new shape (create mode) or update the
  // edited shape's content (edit mode). Empty input cancels instead.
  const submitEditor = React.useCallback(() => {
    const text = editorValue;

    if (editorMode === 'edit') {
      const shapeId = editingTextIdRef.current;
      const shapeIndex = shapes.value.findIndex((s) => s.id === shapeId);
      if (shapeIndex !== -1 && shapes.value[shapeIndex].type === 'text') {
        const shape = shapes.value[shapeIndex];
        // MW - No-op edits shouldn't push history or rebuild arrays.
        if ((shape.content ?? '') !== text) {
          pushHistory(buildSnapshot(shapes.value));
          const { width: tw, height: th } = measureText(
            text || ' ',
            shape.fontSize ?? 32
          );
          const updatedShape = {
            ...shape,
            content: text,
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
        }
      }
      closeEditor();
      return;
    }

    // CREATE mode
    const trimmed = text.trim();
    if (!trimmed) {
      // Nothing to place — just dismiss.
      closeEditor();
      return;
    }

    const { x, y } = pendingPointRef.current;
    const fontSizeValue = activeFontSize.value ?? 32;
    pushHistory(buildSnapshot(shapes.value));
    const { width: textWidth, height: textHeight } = measureText(
      text,
      fontSizeValue
    );

    const newShape = {
      id: Date.now().toString(),
      type: 'text',
      layer: 'text',
      x,
      y,
      width: textWidth,
      height: textHeight,
      rotation: 0,
      colour: activeStrokeColour.value,
      content: text,
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
    notifyChange(selectedShapeId);
    notifyChange(selectedShapeBounds);
    notifyChange(selectedShapeRotation);
    notifySelectedShapeChange(newShape.id);

    closeEditor();
  }, [
    editorValue,
    editorMode,
    shapes,
    setShapeList,
    activeFontSize,
    activeStrokeColour,
    selectedShapeId,
    selectedShapeStart,
    selectedShapeBounds,
    selectedShapeRotation,
    notifySelectedShapeChange,
    pushHistory,
    buildSnapshot,
    closeEditor,
  ]);

  const cancelEditor = React.useCallback(() => {
    closeEditor();
  }, [closeEditor]);

  // MW - Double-tap on a text shape opens the editor in edit mode.
  const doubleTapTextGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onStart((event) => {
          'worklet';
          if (editorOpenShared.value) return;

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
    [scale, translateX, translateY, shapes, editorOpenShared, startTextEdit]
  );

  return {
    editorVisible,
    editorMode,
    editorValue,
    addText,
    startTextEdit,
    onEditorChange,
    submitEditor,
    cancelEditor,
    doubleTapTextGesture,
  };
};

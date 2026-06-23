import React from 'react';
import { Keyboard } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { notifyChange } from '@shopify/react-native-skia';
import { measureText } from '../Components/ShapeNode';

// MW - Encapsulates all text-editing state, keyboard interactions, and the
// two gesture recognisers (double-tap to edit, tap-outside to dismiss)
export const useTextEditing = ({
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
}) => {
  const [editingTextId, setEditingTextId] = React.useState(null);
  const editingTextIdShared = useSharedValue(null);
  const [editingContent, setEditingContent] = React.useState('');
  const [editingScreenPos, setEditingScreenPos] = React.useState({
    x: 0,
    y: 0,
    fontSize: 32,
    colour: 'black',
  });

  const editingScreenPosRef = React.useRef({
    x: 0,
    y: 0,
    fontSize: 32,
    colour: 'black',
  });
  const hasAdjustedForKeyboard = React.useRef(false);
  const priorTranslateYRef = React.useRef(null);

  // MW - Keep the UI-thread shared value in sync with the JS-thread state.
  React.useEffect(() => {
    editingTextIdShared.value = editingTextId;
  }, [editingTextId, editingTextIdShared]);

  const commitTextEdit = React.useCallback(() => {
    if (priorTranslateYRef.current !== null) {
      translateY.value = priorTranslateYRef.current;
      savedTranslateY.value = priorTranslateYRef.current;
      priorTranslateYRef.current = null;
    }
    setEditingTextId(null);
    Keyboard.dismiss();
  }, [translateY, savedTranslateY]);

  const startTextEdit = React.useCallback(
    (shapeId) => {
      const shape = shapes.value.find((s) => s.id === shapeId);
      if (!shape || shape.type !== 'text') return;

      pushHistory(buildSnapshot(shapes.value));

      const currentScale = scale.value;
      const tx = translateX.value;
      const ty = translateY.value;
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
    [editingTextId, shapes, setShapeList, selectedShapeBounds]
  );

  // MW - Create a new text shape at the given canvas-space point. Called via
  // runOnJS from the text placement gesture, which can't access JS-thread
  // resources directly.
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
        layer: 'text',
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
      setShapeList,
      selectedShapeId,
      selectedShapeStart,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
      pushHistory,
      buildSnapshot,
    ]
  );

  // MW - Keyboard visibility: shift the viewport to keep the edited text
  // above the software keyboard; restore on hide.
  React.useEffect(() => {
    if (!editingTextId) {
      hasAdjustedForKeyboard.current = false;
      return;
    }

    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      if (hasAdjustedForKeyboard.current) return;
      hasAdjustedForKeyboard.current = true;

      const keyboardHeight = e.endCoordinates.height;
      const keyboardTop = windowHeight - keyboardHeight;
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

  // MW - Double-tap on a text shape opens the inline editor.
  const doubleTapTextGesture = React.useMemo(
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

  // MW - Tap anywhere outside the editing text element to commit and dismiss.
  const dismissKeyboardGesture = React.useMemo(
    () =>
      Gesture.Tap().onStart((event) => {
        'worklet';
        if (!editingTextIdShared.value) return;

        const currentScale = scale.value || 1;
        const tx = translateX.value || 0;
        const ty = translateY.value || 0;
        const cx = (event.x - tx) / currentScale;
        const cy = (event.y - ty) / currentScale;

        const currentShapes = shapes.value;
        const editingId = editingTextIdShared.value;

        for (let i = currentShapes.length - 1; i >= 0; i--) {
          const shape = currentShapes[i];
          if (shape.id !== editingId || shape.type !== 'text') continue;

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
            return; // Tapping on the text being edited — keep focus
          }
        }

        runOnJS(commitTextEdit)();
      }),
    [scale, translateX, translateY, shapes, editingTextIdShared, commitTextEdit]
  );

  return {
    editingTextId,
    editingContent,
    editingScreenPos,
    editingTextIdShared,
    addText,
    startTextEdit,
    onEditingTextChange,
    commitTextEdit,
    doubleTapTextGesture,
    dismissKeyboardGesture,
  };
};

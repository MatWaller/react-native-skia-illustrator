// MW - Keyboard shortcuts: tool switches, nudging/deleting the selected
// shape, copy/paste, undo/redo, and toggles for grid/ruler/save.

import React from 'react';
import { cloneShape, makeId } from '../constants';

export const useKeyboardShortcuts = ({
  editorVisible,
  stateRef,
  pushHistory,
  setShapes,
  setStrokes,
  setSelectedShapeId,
  setCurrentTool,
  setShowGrid,
  setShowRuler,
  undo,
  redo,
  onSave,
}) => {
  const clipboardRef = React.useRef(null);

  const onKeyDown = React.useCallback(
    (event) => {
      // MW - Modal open: don't let hotkeys interfere with typing.
      if (editorVisible) return;

      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          const current = stateRef.current;
          if (!current.selectedShapeId) return;
          pushHistory();
          setShapes(
            current.shapes.filter(
              (shape) => shape.id !== current.selectedShapeId
            )
          );
          setSelectedShapeId(null);
          return;
        }

        if (event.key.startsWith('Arrow')) {
          const current = stateRef.current;
          if (!current.selectedShapeId) return;
          pushHistory();
          const delta = event.shiftKey ? 10 : 1;
          const next = current.shapes.map((shape) => {
            if (shape.id !== current.selectedShapeId) return shape;
            switch (event.key) {
              case 'ArrowUp':
                return { ...shape, y: shape.y - delta };
              case 'ArrowDown':
                return { ...shape, y: shape.y + delta };
              case 'ArrowLeft':
                return { ...shape, x: shape.x - delta };
              case 'ArrowRight':
                return { ...shape, x: shape.x + delta };
              default:
                return shape;
            }
          });
          setShapes(next);
          return;
        }

        if (event.key === 'c') setCurrentTool('control');
        if (event.key === 'p') setCurrentTool('paint');
        if (event.key === 'h') setCurrentTool('highlighter');
        if (event.key === 't') setCurrentTool('text');
        if (event.key === 'l') setCurrentTool('line');
        if (event.key === 'i') setCurrentTool('shape');
        if (event.key === 'e') setCurrentTool('eraser');
        return;
      }

      const targetTag = event.target?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

      const current = stateRef.current;
      const key = event.key.toLowerCase();

      if (key === 'c') {
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected) return;
        event.preventDefault();
        clipboardRef.current = cloneShape(selected);
        return;
      }

      if (key === 'v') {
        if (!clipboardRef.current) return;
        event.preventDefault();
        pushHistory();
        const duplicate = {
          ...cloneShape(clipboardRef.current),
          id: makeId(clipboardRef.current.type ?? 'shape'),
          x: clipboardRef.current.x + 20,
          y: clipboardRef.current.y + 20,
        };
        setShapes([...current.shapes, duplicate]);
        setSelectedShapeId(duplicate.id);
        return;
      }

      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        setShowRuler((visible) => !visible);
        return;
      }

      if (key === 'g') {
        event.preventDefault();
        setShowGrid((visible) => !visible);
        return;
      }

      if (key === 's') {
        event.preventDefault();
        onSave?.();
        return;
      }

      if (key === 'backspace') {
        event.preventDefault();
        pushHistory();
        setShapes([]);
        setStrokes([]);
        setSelectedShapeId(null);
      }
    },
    [
      editorVisible,
      stateRef,
      pushHistory,
      setShapes,
      setStrokes,
      setSelectedShapeId,
      setCurrentTool,
      setShowGrid,
      setShowRuler,
      undo,
      redo,
      onSave,
    ]
  );

  return { onKeyDown };
};

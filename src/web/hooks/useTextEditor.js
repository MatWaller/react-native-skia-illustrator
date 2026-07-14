// MW - Owns the text-entry modal: opening it to create or edit a text
// shape, and committing or cancelling the edit.

import React from 'react';
import { makeId } from '../constants';
import { measureWebText } from '../utils/text';

export const useTextEditor = ({
  stateRef,
  setShapes,
  setSelectedShapeId,
  setCurrentTool,
  pushHistory,
  defaultText,
}) => {
  const [editor, setEditor] = React.useState({
    visible: false,
    mode: 'create',
    value: '',
    point: null,
    shapeId: null,
  });

  const addTextAt = React.useCallback(
    (point) => {
      setEditor({
        visible: true,
        mode: 'create',
        value: defaultText,
        point,
        shapeId: null,
      });
    },
    [defaultText]
  );

  const editTextShape = React.useCallback(
    (shape) => {
      setSelectedShapeId(shape.id);
      setEditor({
        visible: true,
        mode: 'edit',
        value: shape.content ?? '',
        point: null,
        shapeId: shape.id,
      });
    },
    [setSelectedShapeId]
  );

  const closeEditor = React.useCallback(() => {
    setEditor((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  }, []);

  const submitEditor = React.useCallback(() => {
    const current = stateRef.current;
    const value = editor.value || null;
    if (value == null || value.trim() === '') return;

    pushHistory();
    if (editor.mode === 'edit' && editor.shapeId) {
      const next = current.shapes.map((shape) => {
        if (shape.id !== editor.shapeId) return shape;
        const measured = measureWebText(
          value,
          shape.fontSize ?? current.fontSize
        );
        return {
          ...shape,
          content: value,
          width: measured.width,
          height: measured.height,
        };
      });
      setShapes(next);
    } else if (editor.point) {
      const measured = measureWebText(value, current.fontSize);
      const shape = {
        id: makeId('text'),
        type: 'text',
        x: editor.point.x,
        y: editor.point.y,
        content: value,
        colour: current.currentColour,
        fontSize: current.fontSize,
        width: measured.width,
        height: measured.height,
        layer: 'text',
        rotation: 0,
      };
      setShapes([...current.shapes, shape]);
      setCurrentTool('control');
      setSelectedShapeId(shape.id);
    }
    setEditor((prev) => ({ ...prev, visible: false }));
  }, [
    editor,
    pushHistory,
    setShapes,
    setCurrentTool,
    setSelectedShapeId,
    stateRef,
  ]);

  return {
    editor,
    setEditor,
    addTextAt,
    editTextShape,
    closeEditor,
    submitEditor,
  };
};

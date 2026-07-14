// MW - Undo/redo history stack for shapes, strokes and layers.

import React from 'react';
import { MAX_HISTORY, cloneLayer, cloneShape, cloneStroke } from '../constants';

export const useCanvasHistory = ({
  stateRef,
  setShapes,
  setStrokes,
  setLayers,
  setSelectedShapeId,
}) => {
  const undoRef = React.useRef([]);
  const redoRef = React.useRef([]);
  const [historySize, setHistorySize] = React.useState({ undo: 0, redo: 0 });

  const buildSnapshot = React.useCallback(() => {
    const current = stateRef.current;
    return {
      shapes: current.shapes.map(cloneShape),
      strokes: current.strokes.map(cloneStroke),
      layers: current.layers.map(cloneLayer),
    };
  }, [stateRef]);

  const pushHistory = React.useCallback(() => {
    undoRef.current.push(buildSnapshot());
    if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
    redoRef.current = [];
    setHistorySize({ undo: undoRef.current.length, redo: 0 });
  }, [buildSnapshot]);

  const restoreSnapshot = React.useCallback(
    (snapshot) => {
      setShapes(snapshot.shapes.map(cloneShape));
      setStrokes(snapshot.strokes.map(cloneStroke));
      setLayers(snapshot.layers.map(cloneLayer));
      setSelectedShapeId(null);
    },
    [setShapes, setStrokes, setLayers, setSelectedShapeId]
  );

  const undo = React.useCallback(() => {
    if (!undoRef.current.length) return;
    redoRef.current.push(buildSnapshot());
    restoreSnapshot(undoRef.current.pop());
    setHistorySize({
      undo: undoRef.current.length,
      redo: redoRef.current.length,
    });
  }, [buildSnapshot, restoreSnapshot]);

  const redo = React.useCallback(() => {
    if (!redoRef.current.length) return;
    undoRef.current.push(buildSnapshot());
    restoreSnapshot(redoRef.current.pop());
    setHistorySize({
      undo: undoRef.current.length,
      redo: redoRef.current.length,
    });
  }, [buildSnapshot, restoreSnapshot]);

  return { pushHistory, undo, redo, historySize, undoRef, redoRef };
};

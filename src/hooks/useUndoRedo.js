import React from 'react';
import { Skia, notifyChange } from '@shopify/react-native-skia';

const MAX_HISTORY = 10;

// MW - Manages undo/redo history stacks. Takes a ref to allStrokesPath and
// layersRef (both are already stable refs owned by the skiaillustrator :)), plus
// the React state setters it needs to call during restore. Returns stable
// callbacks and a historySize value that can drive canUndo/canRedo reads.
export const useUndoRedo = ({
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
}) => {
  const undoStack = React.useRef([]);
  const redoStack = React.useRef([]);
  const [historySize, setHistorySize] = React.useState({ undo: 0, redo: 0 });

  const buildSnapshot = React.useCallback(
    (shapesArray) => ({
      shapes: shapesArray.map((s) => ({ ...s })),
      strokes: allStrokesRef.current.slice(),
      layers: layersRef.current.map((l) => ({ ...l })),
    }),
    [allStrokesRef, layersRef]
  );

  // MW - Push a snapshot onto the undo stack and clear redo.
  const pushHistory = React.useCallback((snapshot) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    setHistorySize({ undo: undoStack.current.length, redo: 0 });
  }, []);

  // MW - Restore a snapshot: reuse stroke references, clone shapes, clear
  // selection. Legacy snapshots (pathSVG strings) are still rebuilt for
  // backward compatibility.
  const restoreSnapshot = React.useCallback(
    (snapshot) => {
      const restoredStrokes = snapshot.strokes.map((stroke) =>
        stroke.path
          ? stroke
          : {
              ...stroke,
              path:
                Skia.Path.MakeFromSVGString(stroke.pathSVG ?? '') ??
                Skia.Path.Make(),
            }
      );
      const clonedShapes = snapshot.shapes.map((s) => ({ ...s }));
      shapes.value = clonedShapes;
      setShapeList(clonedShapes);
      notifyChange(shapes);
      setAllStrokesPath(restoredStrokes);
      if (snapshot.layers) setLayers(snapshot.layers);
      selectedShapeId.value = null;
      selectedShapeBounds.value = null;
      selectedShapeRotation.value = 0;
      notifySelectedShapeChange(null);
    },
    [
      shapes,
      setShapeList,
      setAllStrokesPath,
      setLayers,
      selectedShapeId,
      selectedShapeBounds,
      selectedShapeRotation,
      notifySelectedShapeChange,
    ]
  );

  const undo = React.useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(buildSnapshot(shapes.value));
    if (redoStack.current.length > MAX_HISTORY) redoStack.current.shift();
    restoreSnapshot(undoStack.current.pop());
    setHistorySize({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });
  }, [buildSnapshot, restoreSnapshot, shapes]);

  const redo = React.useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(buildSnapshot(shapes.value));
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    restoreSnapshot(redoStack.current.pop());
    setHistorySize({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });
  }, [buildSnapshot, restoreSnapshot, shapes]);

  // MW - Empty both history stacks and reset the size counters. Used on unmount
  // so the snapshots (and their retained Skia paths) can be garbage collected.
  const clearHistory = React.useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setHistorySize({ undo: 0, redo: 0 });
  }, []);

  return {
    buildSnapshot,
    pushHistory,
    restoreSnapshot,
    undo,
    redo,
    historySize,
    clearHistory,
    canUndo: () => undoStack.current.length > 0,
    canRedo: () => redoStack.current.length > 0,
  };
};

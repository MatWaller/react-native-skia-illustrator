import React from 'react';
import { Skia, notifyChange } from '@shopify/react-native-skia';

const MAX_HISTORY = 50;

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

  // MW - Serialise the current canvas state into a plain-JS snapshot.
  // isFilled is now included so flatten-to-stroke round-trips correctly.
  const buildSnapshot = React.useCallback(
    (shapesArray) => ({
      shapes: shapesArray.map((s) => ({ ...s })),
      strokes: allStrokesRef.current.map(
        ({ path, colour, thickness, isEraser, isFilled }) => ({
          pathSVG: path.toSVGString(),
          colour,
          thickness,
          isEraser,
          isFilled,
        })
      ),
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

  // MW - Restore a snapshot: rebuild Skia paths, clone shapes, clear selection.
  const restoreSnapshot = React.useCallback(
    (snapshot) => {
      const restoredStrokes = snapshot.strokes.map(
        ({ pathSVG, colour, thickness, isEraser, isFilled }) => ({
          path: Skia.Path.MakeFromSVGString(pathSVG) ?? Skia.Path.Make(),
          colour,
          thickness,
          isEraser,
          isFilled,
        })
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

  return {
    buildSnapshot,
    pushHistory,
    restoreSnapshot,
    undo,
    redo,
    historySize,
    canUndo: () => undoStack.current.length > 0,
    canRedo: () => redoStack.current.length > 0,
  };
};

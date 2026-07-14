// MW - Pointer-driven canvas interactions: panning, drawing strokes,
// creating shapes, and moving/resizing/rotating the selected shape.

import React from 'react';
import { getShapeAABB } from '../../utils/shapeUtils';
import { HANDLE_CURSORS, cloneShape } from '../constants';
import {
  findTopShapeAt,
  getShapeBounds,
  getShapeOrigin,
  normalizeShape,
  rotatePoint,
  selectionHandleAt,
} from '../utils/geometry';
import { measureWebText, withHighlighterAlpha } from '../utils/text';

export const usePointerInteractions = ({
  active,
  canvasRef,
  pointerRef,
  hoverPointRef,
  stateRef,
  renderCanvas,
  pushHistory,
  setShapes,
  setStrokes,
  setSelectedShapeId,
  setTransform,
  addTextAt,
  editTextShape,
  addShapeAt,
}) => {
  const screenToCanvas = React.useCallback(
    (clientX, clientY) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const current = stateRef.current;
      return {
        x:
          (clientX - rect.left - current.transform.x) / current.transform.scale,
        y: (clientY - rect.top - current.transform.y) / current.transform.scale,
      };
    },
    [canvasRef, stateRef]
  );

  // MW - Whether a canvas-space point sits on the paper. Paint strokes only
  // record on-paper samples so drawing outside the canvas leaves no marks.
  const isOnPaper = React.useCallback(
    (point) => {
      const { width, height } = stateRef.current.resolvedCanvas;
      return (
        point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height
      );
    },
    [stateRef]
  );

  const findTopShape = React.useCallback(
    (point) =>
      findTopShapeAt(point, stateRef.current.shapes, stateRef.current.layers),
    [stateRef]
  );

  const updateSelectedBounds = React.useCallback(
    (shape) => {
      setShapes((prev) =>
        prev.map((s) => (s.id === shape.id ? normalizeShape(shape) : s))
      );
    },
    [setShapes]
  );

  const eraseShapesInSegment = React.useCallback(
    (points, thickness) => {
      const current = stateRef.current;
      if (!current.enableEraseShape || points.length === 0) return;
      const radius = thickness / 2;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const box = {
        minX: Math.min(...xs) - radius,
        maxX: Math.max(...xs) + radius,
        minY: Math.min(...ys) - radius,
        maxY: Math.max(...ys) + radius,
      };
      const hitIds = current.shapes
        .filter((shape) => {
          const aabb = getShapeAABB(shape);
          return (
            aabb.x < box.maxX &&
            aabb.x + aabb.width > box.minX &&
            aabb.y < box.maxY &&
            aabb.y + aabb.height > box.minY
          );
        })
        .map((shape) => shape.id);
      if (hitIds.length === 0) return;
      setShapes((prev) => prev.filter((shape) => !hitIds.includes(shape.id)));
      if (hitIds.includes(current.selectedShapeId)) setSelectedShapeId(null);
    },
    [stateRef, setShapes, setSelectedShapeId]
  );

  // MW - Erases placed shapes under the segment as the eraser moves; the
  // eraser's own ink is committed as a normal destination-out stroke on
  // pointer-up so the live preview always matches the final result.
  const eraseSegment = React.useCallback(
    (from, to, thickness) => {
      const pointer = pointerRef.current;
      if (pointer && !pointer.historyPushed) {
        pushHistory();
        pointer.historyPushed = true;
      }
      const points = from ? [from, to] : [to];
      eraseShapesInSegment(points, thickness);
    },
    [pointerRef, pushHistory, eraseShapesInSegment]
  );

  const getHoverCursor = React.useCallback(
    (point) => {
      const current = stateRef.current;
      const selected =
        current.shapes.find((shape) => shape.id === current.selectedShapeId) ??
        null;
      const handle = selectionHandleAt(
        selected,
        point,
        current.transform.scale
      );
      return HANDLE_CURSORS[handle] ?? 'crosshair';
    },
    [stateRef]
  );

  const onPointerDown = React.useCallback(
    (event) => {
      if (!active) return;
      // MW - Middle-mouse-button drag always pans the viewport, regardless
      // of the active tool, and takes priority over any tool's own
      // pointerdown handling so it never conflicts with paint/shape/etc.
      if (event.button === 1) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerRef.current = {
          mode: 'pan',
          startClient: { x: event.clientX, y: event.clientY },
          startTransform: stateRef.current.transform,
        };
        return;
      }
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const current = stateRef.current;
      const point = screenToCanvas(event.clientX, event.clientY);
      const selected =
        current.shapes.find((shape) => shape.id === current.selectedShapeId) ??
        null;
      const handle = selectionHandleAt(
        selected,
        point,
        current.transform.scale
      );
      const hit = findTopShape(point);

      if (
        event.detail === 2 &&
        hit?.type === 'text' &&
        current.currentTool !== 'shape'
      ) {
        editTextShape(hit);
        return;
      }

      if (current.currentTool === 'text') {
        if (hit?.type === 'text') editTextShape(hit);
        else addTextAt(point);
        return;
      }

      if (
        current.currentTool === 'paint' ||
        current.currentTool === 'eraser' ||
        current.currentTool === 'highlighter'
      ) {
        const onPaper = isOnPaper(point);
        const isHighlighter = current.currentTool === 'highlighter';
        const isEraser = current.currentTool === 'eraser';
        pointerRef.current = {
          mode: 'stroke',
          wasOnPaper: onPaper,
          historyPushed: false,
          activeStroke: {
            points: onPaper ? [point] : [],
            colour: isEraser
              ? 'black'
              : isHighlighter
                ? withHighlighterAlpha(current.currentHighlighterColour)
                : current.currentColour,
            thickness: current.brushSize,
            isEraser,
            isHighlighter,
          },
        };
        if (isEraser && onPaper) eraseSegment(null, point, current.brushSize);
        renderCanvas();
        return;
      }

      // MW - Shape tool always creates a new shape; it never selects or
      // moves ones already placed (that is what control mode is for).
      if (current.currentTool === 'shape' && current.shapeToolType) {
        if (
          current.shapeToolType === 'line' &&
          pointerRef.current?.pendingLine
        ) {
          const start = pointerRef.current.pendingLine;
          pointerRef.current = null;
          addShapeAt('line', start, point);
          return;
        }
        pointerRef.current = {
          mode: 'create-shape',
          start: point,
          last: point,
          type: current.shapeToolType,
          pendingLine: pointerRef.current?.pendingLine ?? null,
        };
        return;
      }

      if (handle === 'rotate') {
        pointerRef.current = {
          mode: 'rotate',
          shapeId: selected.id,
          origin: getShapeOrigin(selected),
          startShape: cloneShape(selected),
        };
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        pushHistory();
        return;
      }
      if (handle) {
        pointerRef.current = {
          mode: 'resize',
          handle,
          shapeId: selected.id,
          start: point,
          startShape: cloneShape(selected),
        };
        if (canvasRef.current)
          canvasRef.current.style.cursor = HANDLE_CURSORS[handle];
        pushHistory();
        return;
      }
      if (hit) {
        setSelectedShapeId(hit.id);
        pointerRef.current = {
          mode: 'move-shape',
          shapeId: hit.id,
          start: point,
          startShape: cloneShape(hit),
        };
        pushHistory();
        return;
      }
      setSelectedShapeId(null);
      pointerRef.current = {
        mode: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startTransform: current.transform,
      };
    },
    [
      active,
      addShapeAt,
      addTextAt,
      editTextShape,
      canvasRef,
      eraseSegment,
      findTopShape,
      isOnPaper,
      pointerRef,
      pushHistory,
      renderCanvas,
      screenToCanvas,
      setSelectedShapeId,
      stateRef,
    ]
  );

  const onPointerMove = React.useCallback(
    (event) => {
      const pointer = pointerRef.current;
      const point = screenToCanvas(event.clientX, event.clientY);
      hoverPointRef.current = point;
      if (!pointer) {
        if (canvasRef.current)
          canvasRef.current.style.cursor = getHoverCursor(point);
        renderCanvas();
        return;
      }
      if (pointer.mode === 'stroke') {
        // MW - Only record on-paper samples. When the pointer leaves and
        // re-enters, mark the first sample back as a subpath break so no
        // line is drawn across the off-paper gap.
        if (!isOnPaper(point)) {
          pointer.wasOnPaper = false;
          return;
        }
        const isContinuing =
          pointer.wasOnPaper && pointer.activeStroke.points.length > 0;
        const prevPoint = isContinuing
          ? pointer.activeStroke.points[pointer.activeStroke.points.length - 1]
          : null;
        pointer.activeStroke.points.push(
          isContinuing ? point : { ...point, break: true }
        );
        pointer.wasOnPaper = true;
        if (pointer.activeStroke.isEraser)
          eraseSegment(prevPoint, point, pointer.activeStroke.thickness);
        renderCanvas();
        return;
      }
      if (pointer.mode === 'pan') {
        setTransform({
          ...pointer.startTransform,
          x: pointer.startTransform.x + event.clientX - pointer.startClient.x,
          y: pointer.startTransform.y + event.clientY - pointer.startClient.y,
        });
        return;
      }
      if (pointer.mode === 'create-shape') {
        pointer.last = point;
        renderCanvas();
        return;
      }
      if (pointer.mode === 'move-shape') {
        const dx = point.x - pointer.start.x;
        const dy = point.y - pointer.start.y;
        updateSelectedBounds({
          ...pointer.startShape,
          x: pointer.startShape.x + dx,
          y: pointer.startShape.y + dy,
        });
        return;
      }
      if (pointer.mode === 'rotate') {
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        const angle =
          (Math.atan2(point.y - pointer.origin.y, point.x - pointer.origin.x) *
            180) /
            Math.PI +
          90;
        updateSelectedBounds({ ...pointer.startShape, rotation: angle });
        return;
      }
      if (pointer.mode === 'resize') {
        if (canvasRef.current)
          canvasRef.current.style.cursor = HANDLE_CURSORS[pointer.handle];
        const shape = pointer.startShape;
        const local = rotatePoint(
          point,
          getShapeOrigin(shape),
          -(shape.rotation ?? 0)
        );
        const b = getShapeBounds(shape);
        let nx = b.x;
        let ny = b.y;
        let nw = b.width;
        let nh = b.height;
        if (pointer.handle.includes('e')) nw = Math.max(1, local.x - b.x);
        if (pointer.handle.includes('s')) nh = Math.max(1, local.y - b.y);
        if (pointer.handle.includes('w')) {
          nw = Math.max(1, b.x + b.width - local.x);
          nx = b.x + b.width - nw;
        }
        if (pointer.handle.includes('n')) {
          nh = Math.max(1, b.y + b.height - local.y);
          ny = b.y + b.height - nh;
        }
        if (shape.type === 'circle')
          updateSelectedBounds({
            ...shape,
            x: nx + nw / 2,
            y: ny + nh / 2,
            radius: Math.min(nw, nh) / 2,
          });
        else if (shape.type === 'text') {
          // MW - Re-measure at the dragged font size so the box always
          // matches the true rendered text size, with no size floor.
          const measured = measureWebText(shape.content ?? '', nh);
          updateSelectedBounds({
            ...shape,
            x: nx,
            y: ny + measured.height,
            width: measured.width,
            height: measured.height,
            fontSize: nh,
          });
        } else
          updateSelectedBounds({
            ...shape,
            x: nx,
            y: ny,
            width: nw,
            height: nh,
          });
      }
    },
    [
      canvasRef,
      eraseSegment,
      getHoverCursor,
      hoverPointRef,
      isOnPaper,
      pointerRef,
      renderCanvas,
      screenToCanvas,
      setTransform,
      updateSelectedBounds,
    ]
  );

  const onPointerUp = React.useCallback(
    (event) => {
      const pointer = pointerRef.current;
      if (!pointer) return;
      const point = screenToCanvas(event.clientX, event.clientY);
      if (pointer.mode === 'stroke') {
        const stroke = pointer.activeStroke;
        // MW - Gesture never touched the paper: nothing to commit.
        if (stroke.points.length === 0) {
          pointerRef.current = null;
          renderCanvas();
          return;
        }
        // MW - Commit exactly what was drawn live (including erasers) so
        // the result never differs from the active-drag preview.
        if (!pointer.historyPushed) pushHistory();
        const committed = {
          ...stroke,
          points: stroke.points.map((p) => ({ ...p })),
        };
        // MW - Patch stateRef synchronously so an imperative call right
        // after (e.g. a tool switch that flattens) never reads a stale
        // strokes array missing the one we just committed.
        stateRef.current = {
          ...stateRef.current,
          strokes: [...stateRef.current.strokes, committed],
        };
        setStrokes((prev) => [...prev, committed]);
        pointerRef.current = null;
        return;
      }

      if (pointer.mode === 'create-shape') {
        const moved =
          Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 3;
        pointerRef.current = null;
        if (pointer.type === 'line' && !moved) {
          pointerRef.current = { pendingLine: pointer.start };
          renderCanvas();
          return;
        }
        addShapeAt(pointer.type, pointer.start, moved ? point : null);
        return;
      }
      if (
        (pointer.mode === 'resize' || pointer.mode === 'rotate') &&
        canvasRef.current
      )
        canvasRef.current.style.cursor = getHoverCursor(point);
      pointerRef.current = pointer.pendingLine
        ? { pendingLine: pointer.pendingLine }
        : null;
    },
    [
      addShapeAt,
      canvasRef,
      getHoverCursor,
      pointerRef,
      pushHistory,
      renderCanvas,
      screenToCanvas,
      setStrokes,
      stateRef,
    ]
  );

  const onPointerLeave = React.useCallback(() => {
    hoverPointRef.current = null;
    renderCanvas();
  }, [hoverPointRef, renderCanvas]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    getHoverCursor,
  };
};

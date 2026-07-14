// MW - Serialising the canvas to/from plain JSON, and rendering it to an
// offscreen context for PNG export.

import React from 'react';
import { getShapeLayer } from '../../utils/shapeUtils';
import {
  DEFAULT_LAYERS,
  cloneLayer,
  cloneShape,
  cloneStroke,
} from '../constants';
import {
  drawShape,
  drawShapeIsolated,
  drawStroke,
  shapeHasEraserSegments,
} from '../utils/drawing';

export const useCanvasSerialization = ({
  stateRef,
  imageRef,
  pushHistory,
  setLayers,
  setShapes,
  setStrokes,
  setSelectedShapeId,
}) => {
  const drawToContext = React.useCallback(
    (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      if (imageRef.current)
        ctx.drawImage(imageRef.current, 0, 0, width, height);
      const drawingLayers = stateRef.current.layers;
      const orderedLayers = [
        ...drawingLayers.filter((layer) => layer.id !== 'drawing'),
        ...drawingLayers.filter((layer) => layer.id === 'drawing'),
      ];
      orderedLayers.forEach((layer) => {
        if (layer.id === 'drawing') {
          // MW - Isolate so any eraser ink only cuts into this buffer's
          // own strokes, not the paper already drawn on the export canvas.
          const buffer = document.createElement('canvas');
          buffer.width = Math.max(1, Math.ceil(width));
          buffer.height = Math.max(1, Math.ceil(height));
          const bctx = buffer.getContext('2d');
          stateRef.current.strokes.forEach((stroke) =>
            drawStroke(bctx, stroke)
          );
          ctx.drawImage(buffer, 0, 0, width, height);
        } else
          stateRef.current.shapes
            .filter((shape) => getShapeLayer(shape) === layer.id)
            .forEach((shape) => {
              if (shapeHasEraserSegments(shape))
                drawShapeIsolated(ctx, shape, width, height, 1);
              else drawShape(ctx, shape);
            });
      });
    },
    [imageRef, stateRef]
  );

  const serializeCanvas = React.useCallback(() => {
    const current = stateRef.current;
    return JSON.stringify({
      version: 1,
      renderer: 'html-canvas',
      layers: current.layers.map(cloneLayer),
      shapes: current.shapes.map(cloneShape),
      strokes: current.strokes.map(cloneStroke),
    });
  }, [stateRef]);

  const loadCanvas = React.useCallback(
    (input) => {
      const data = typeof input === 'string' ? JSON.parse(input) : input;
      if (!data || typeof data !== 'object')
        throw new Error('loadCanvas: invalid canvas data');
      pushHistory();
      setLayers((data.layers ?? DEFAULT_LAYERS).map(cloneLayer));
      setShapes((data.shapes ?? []).map(cloneShape));
      setStrokes(
        (data.strokes ?? []).map((stroke) => ({
          ...cloneStroke(stroke),
          pathSvg: stroke.pathSvg ?? stroke.pathSVG,
        }))
      );
      setSelectedShapeId(null);
    },
    [pushHistory, setLayers, setShapes, setStrokes, setSelectedShapeId]
  );

  const saveCanvasAsImage = React.useCallback(async () => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(
      1,
      Math.ceil(stateRef.current.resolvedCanvas.width)
    );
    exportCanvas.height = Math.max(
      1,
      Math.ceil(stateRef.current.resolvedCanvas.height)
    );
    const ctx = exportCanvas.getContext('2d');
    drawToContext(ctx, exportCanvas.width, exportCanvas.height);
    return exportCanvas.toDataURL('image/png');
  }, [drawToContext, stateRef]);

  return { serializeCanvas, loadCanvas, saveCanvasAsImage };
};

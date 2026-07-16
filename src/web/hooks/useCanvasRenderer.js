// MW - Draws the whole scene (paper, layers, live strokes, selection) to
// the canvas each time relevant state changes.

import React from 'react';
import { getShapeLayer } from '../../utils/shapeUtils';
import {
  drawGrid,
  drawRuler,
  drawSelection,
  drawShape,
  drawShapeIsolated,
  drawStroke,
  shapeHasEraserSegments,
} from '../utils/drawing';
import { isBrowser } from '../utils/text';

export const useCanvasRenderer = ({
  canvasRef,
  imageRef,
  pointerRef,
  hoverPointRef,
  stateRef,
  viewportSize,
  transform,
  resolvedCanvas,
  showRuler,
  rulerUnit,
  showGrid,
  layers,
  strokes,
  shapes,
  selectedShape,
}) => {
  const renderCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = isBrowser() ? window.devicePixelRatio || 1 : 1;
    const width = Math.max(1, viewportSize.width);
    const height = Math.max(1, viewportSize.height);
    if (
      canvas.width !== Math.floor(width * dpr) ||
      canvas.height !== Math.floor(height * dpr)
    ) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#dfdfdf';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, resolvedCanvas.width, resolvedCanvas.height);
    ctx.shadowColor = 'transparent';
    if (showRuler)
      drawRuler(ctx, resolvedCanvas.width, resolvedCanvas.height, rulerUnit);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, resolvedCanvas.width, resolvedCanvas.height);
    ctx.clip();
    if (showGrid) drawGrid(ctx, resolvedCanvas.width, resolvedCanvas.height);
    if (imageRef.current)
      ctx.drawImage(
        imageRef.current,
        0,
        0,
        resolvedCanvas.width,
        resolvedCanvas.height
      );

    // MW - The drawing layer is drawn last so committed/active ink stays
    // above shapes, icons and text regardless of the layers array order.
    const orderedLayers = [
      ...layers.filter((layer) => layer.id !== 'drawing'),
      ...layers.filter((layer) => layer.id === 'drawing'),
    ];
    orderedLayers.forEach((layer) => {
      if (layer.id === 'drawing') {
        // MW - Rasterise at the current zoom/DPI instead of a fixed paper
        // resolution, so live strokes stay as crisp as flattened shapes.
        const bufferScale = dpr * transform.scale;
        const buffer = document.createElement('canvas');
        buffer.width = Math.max(
          1,
          Math.ceil(resolvedCanvas.width * bufferScale)
        );
        buffer.height = Math.max(
          1,
          Math.ceil(resolvedCanvas.height * bufferScale)
        );
        const bctx = buffer.getContext('2d');
        bctx.scale(bufferScale, bufferScale);
        strokes.forEach((stroke) => drawStroke(bctx, stroke));
        const activeStroke = pointerRef.current?.activeStroke;
        if (activeStroke) drawStroke(bctx, activeStroke);
        ctx.drawImage(
          buffer,
          0,
          0,
          resolvedCanvas.width,
          resolvedCanvas.height
        );
      } else {
        shapes
          .filter((shape) => getShapeLayer(shape) === layer.id)
          .forEach((shape) => {
            if (shapeHasEraserSegments(shape))
              drawShapeIsolated(
                ctx,
                shape,
                resolvedCanvas.width,
                resolvedCanvas.height,
                dpr * transform.scale
              );
            else drawShape(ctx, shape);
          });
      }
    });

    if (pointerRef.current?.pendingLine) {
      const p = pointerRef.current.pendingLine;
      ctx.fillStyle = '#6366f1';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 / transform.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // MW - Subtle brush-size preview outline that follows the cursor
    // while the paint, highlighter or eraser tool is active.
    const brushTool = stateRef.current.currentTool;
    if (
      (brushTool === 'paint' ||
        brushTool === 'paint-straight' ||
        brushTool === 'highlighter' ||
        brushTool === 'eraser') &&
      hoverPointRef.current
    ) {
      const p = hoverPointRef.current;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle =
        brushTool === 'highlighter'
          ? stateRef.current.currentHighlighterColour
          : brushTool === 'eraser'
            ? '#334155'
            : stateRef.current.currentColour;
      ctx.lineWidth = 1 / transform.scale;
      ctx.beginPath();
      ctx.arc(
        p.x,
        p.y,
        Math.max(1, stateRef.current.brushSize / 2),
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
    }

    drawSelection(ctx, selectedShape, transform.scale);
    ctx.restore();
    ctx.restore();
  }, [
    canvasRef,
    imageRef,
    pointerRef,
    hoverPointRef,
    stateRef,
    viewportSize,
    transform,
    resolvedCanvas,
    showRuler,
    rulerUnit,
    showGrid,
    layers,
    strokes,
    shapes,
    selectedShape,
  ]);

  React.useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  return renderCanvas;
};

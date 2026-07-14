// MW - Canvas 2D drawing functions. Each takes a ctx and draws directly,
// no state is kept here.

import { HANDLE_SIZE, ROTATE_HANDLE_OFFSET, STROKE_TYPES } from '../constants';
import { getShapeBounds, getShapeOrigin, pathForShape } from './geometry';

export const drawStroke = (ctx, stroke) => {
  ctx.save();
  if (stroke.isEraser) ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = stroke.colour ?? 'black';
  ctx.fillStyle = stroke.colour ?? 'black';
  ctx.lineWidth = stroke.thickness ?? 8;
  ctx.lineCap = stroke.isHighlighter ? 'square' : 'round';
  ctx.lineJoin = stroke.isHighlighter ? 'miter' : 'round';

  if (
    stroke.pathSvg &&
    typeof window !== 'undefined' &&
    typeof window.Path2D !== 'undefined'
  ) {
    const path = new window.Path2D(stroke.pathSvg);
    if (stroke.isFilled) ctx.fill(path);
    else ctx.stroke(path);
    ctx.restore();
    return;
  }

  const points = stroke.points ?? [];
  if (points.length === 0) {
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const point = points[i];
    // MW - A 'break' point starts a new subpath: the pointer left the paper
    // and re-entered, so no connecting line is drawn across the gap.
    if (point.break) {
      ctx.moveTo(point.x, point.y);
      continue;
    }
    ctx.quadraticCurveTo(
      prev.x,
      prev.y,
      (prev.x + point.x) / 2,
      (prev.y + point.y) / 2
    );
  }
  ctx.stroke();
  ctx.restore();
};

export const drawShape = (ctx, shape) => {
  const colour = shape.colour ?? 'black';
  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const origin = getShapeOrigin(shape);
  if (shape.rotation) {
    ctx.translate(origin.x, origin.y);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-origin.x, -origin.y);
  }

  if (shape.type === 'circle') {
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, shape.radius ?? 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (shape.type === 'text') {
    const fontSize = shape.fontSize ?? 32;
    ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(shape.content ?? '', shape.x, shape.y);
    ctx.restore();
    return;
  }

  if (shape.type === 'path') {
    const segments =
      shape.pathSegments ??
      (shape.pathSvg
        ? [
            {
              pathSvg: shape.pathSvg,
              colour: shape.colour,
              thickness: shape.thickness,
            },
          ]
        : []);
    if (
      segments.length > 0 &&
      typeof window !== 'undefined' &&
      typeof window.Path2D !== 'undefined'
    ) {
      // MW - Path segments are baked at absolute coords; map them into the
      // shape's live x/y/width/height so it can be moved/resized normally.
      const bounds = shape.pathBounds ?? {
        x: shape.x,
        y: shape.y,
        width: shape.width || 1,
        height: shape.height || 1,
      };
      ctx.translate(shape.x, shape.y);
      ctx.scale(
        (shape.width ?? bounds.width) / (bounds.width || 1),
        (shape.height ?? bounds.height) / (bounds.height || 1)
      );
      ctx.translate(-bounds.x, -bounds.y);
      segments.forEach((segment) => {
        if (!segment.pathSvg) return;
        ctx.save();
        if (segment.isEraser) ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = segment.colour ?? 'black';
        ctx.fillStyle = segment.colour ?? 'black';
        ctx.lineWidth = segment.thickness ?? 8;
        ctx.lineCap = segment.isHighlighter ? 'square' : 'round';
        ctx.lineJoin = segment.isHighlighter ? 'miter' : 'round';
        const path2d = new window.Path2D(segment.pathSvg);
        if (segment.isFilled) ctx.fill(path2d);
        else ctx.stroke(path2d);
        ctx.restore();
      });
    }
    ctx.restore();
    return;
  }

  if (shape.type === 'icon') {
    if (
      shape.iconPath &&
      typeof window !== 'undefined' &&
      typeof window.Path2D !== 'undefined'
    ) {
      const vbW = shape.iconViewBox?.width ?? 512;
      const vbH = shape.iconViewBox?.height ?? 512;
      ctx.translate(shape.x, shape.y);
      ctx.scale((shape.width ?? vbW) / vbW, (shape.height ?? vbH) / vbH);
      ctx.fill(new window.Path2D(shape.iconPath));
    }
    ctx.restore();
    return;
  }

  ctx.beginPath();
  pathForShape(ctx, shape);
  if (STROKE_TYPES.has(shape.type)) ctx.stroke();
  else ctx.fill();
  ctx.restore();
};

// MW - A flattened path with any eraser segment must never draw straight
// onto the main canvas: its destination-out would punch through the paper
// and everything already drawn beneath it, not just its own ink.
export const shapeHasEraserSegments = (shape) =>
  shape.type === 'path' &&
  Array.isArray(shape.pathSegments) &&
  shape.pathSegments.some((segment) => segment.isEraser);

// MW - Draws a shape on an offscreen buffer first so its own eraser segments
// only cut into itself, then composites the result onto the real canvas.
export const drawShapeIsolated = (ctx, shape, width, height, bufferScale) => {
  const buffer = document.createElement('canvas');
  buffer.width = Math.max(1, Math.ceil(width * bufferScale));
  buffer.height = Math.max(1, Math.ceil(height * bufferScale));
  const bctx = buffer.getContext('2d');
  bctx.scale(bufferScale, bufferScale);
  drawShape(bctx, shape);
  ctx.drawImage(buffer, 0, 0, width, height);
};

export const drawGrid = (ctx, width, height) => {
  const minor = 10;
  const major = 50;
  ctx.save();
  for (let x = 0; x <= width; x += minor) {
    ctx.beginPath();
    ctx.strokeStyle =
      x % major === 0 ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.10)';
    ctx.lineWidth = x % major === 0 ? 1 : 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += minor) {
    ctx.beginPath();
    ctx.strokeStyle =
      y % major === 0 ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.10)';
    ctx.lineWidth = y % major === 0 ? 1 : 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
};

export const drawRuler = (ctx, width, height, unit) => {
  ctx.save();
  ctx.fillStyle = 'rgba(248,250,252,0.92)';
  ctx.strokeStyle = 'rgba(15,23,42,0.25)';
  ctx.fillRect(0, -24, width, 24);
  ctx.fillRect(-24, 0, 24, height);
  ctx.strokeRect(0, -24, width, 24);
  ctx.strokeRect(-24, 0, 24, height);
  ctx.fillStyle = '#334155';
  ctx.font = '10px system-ui, sans-serif';
  const step = unit === 'cm' ? 37.795 : 50;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, -24);
    ctx.lineTo(x, -8);
    ctx.stroke();
    ctx.fillText(
      unit === 'cm' ? String(Math.round(x / step)) : String(Math.round(x)),
      x + 2,
      -10
    );
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(-24, y);
    ctx.lineTo(-8, y);
    ctx.stroke();
    ctx.save();
    ctx.translate(-21, y + 4);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(
      unit === 'cm' ? String(Math.round(y / step)) : String(Math.round(y)),
      0,
      0
    );
    ctx.restore();
  }
  ctx.restore();
};

export const drawSelection = (ctx, shape, scale) => {
  if (!shape) return;
  const b = getShapeBounds(shape);
  if (!b || b.width === 0 || b.height === 0) return;
  const origin = getShapeOrigin(shape);
  const hs = HANDLE_SIZE / scale;
  ctx.save();
  if (shape.rotation) {
    ctx.translate(origin.x, origin.y);
    ctx.rotate((shape.rotation * Math.PI) / 180);
    ctx.translate(-origin.x, -origin.y);
  }
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.strokeRect(b.x - 5, b.y - 5, b.width + 10, b.height + 10);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2563eb';
  const points = [
    [b.x - 5, b.y - 5],
    [b.x + b.width + 5, b.y - 5],
    [b.x + b.width + 5, b.y + b.height + 5],
    [b.x - 5, b.y + b.height + 5],
  ];
  points.forEach(([x, y]) => {
    ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
    ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
  });
  const rx = b.x + b.width / 2;
  const ry = b.y - ROTATE_HANDLE_OFFSET;
  ctx.beginPath();
  ctx.moveTo(b.x + b.width / 2, b.y - 5);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rx, ry, hs * 0.65, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

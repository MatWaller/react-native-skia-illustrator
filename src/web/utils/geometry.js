// MW - Pure geometry helpers: shape bounds, hit testing and path building.
// No canvas drawing here, just maths shared by rendering and interaction.

import { getShapeLayer } from '../../utils/shapeUtils';
import {
  HANDLE_SIZE,
  ROTATE_HANDLE_OFFSET,
  STROKE_TYPES,
  makeId,
} from '../constants';

export const pointsToSvgPath = (points) => {
  if (!points || points.length === 0) return '';
  // MW - A single-point "dot" click has no line segment to stroke; add a
  // tiny hop so it still renders once baked into a flattened path shape.
  if (points.length === 1) {
    const p = points[0];
    return `M${p.x},${p.y} L${p.x + 0.01},${p.y + 0.01}`;
  }
  let d = '';
  points.forEach((p, i) => {
    d += `${i === 0 || p.break ? 'M' : 'L'}${p.x},${p.y} `;
  });
  return d.trim();
};

export const rotatePoint = (point, origin, degrees) => {
  if (!degrees) return point;
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
};

export const getShapeBounds = (shape) => {
  if (!shape) return null;
  if (shape.type === 'circle') {
    const r = shape.radius ?? 10;
    return { x: shape.x - r, y: shape.y - r, width: r * 2, height: r * 2 };
  }
  if (shape.type === 'text') {
    const h = shape.height ?? shape.fontSize ?? 32;
    return { x: shape.x, y: shape.y - h, width: shape.width ?? 0, height: h };
  }
  const w = shape.width ?? 0;
  const h = shape.height ?? 0;
  return {
    x: w < 0 ? shape.x + w : shape.x,
    y: h < 0 ? shape.y + h : shape.y,
    width: Math.abs(w),
    height: Math.abs(h),
  };
};

export const getShapeOrigin = (shape) => {
  const b = getShapeBounds(shape);
  if (!b) return { x: 0, y: 0 };
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

export const normalizeShape = (shape) => {
  // MW - Directional shapes (line/arrow/etc.) must keep their signed
  // width/height; flipping them to positive mirrors the drawn direction.
  if (shape.type === 'circle' || STROKE_TYPES.has(shape.type)) return shape;
  const w = shape.width ?? 0;
  const h = shape.height ?? 0;
  if (w >= 0 && h >= 0) return shape;
  return {
    ...shape,
    x: w < 0 ? shape.x + w : shape.x,
    y: h < 0 ? shape.y + h : shape.y,
    width: Math.abs(w),
    height: Math.abs(h),
  };
};

// MW - Traces a shape's outline onto any path-like context (real 2D context
// or the fake recorder used by shapeToStroke below).
export const pathForShape = (ctx, shape) => {
  const x = shape.x;
  const y = shape.y;
  const w = shape.width ?? 0;
  const h = shape.height ?? 0;
  switch (shape.type) {
    case 'line':
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      break;
    case 'triangle':
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      break;
    case 'arrow':
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w - 10, y + h / 2);
      ctx.lineTo(x + w - 10, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w - 10, y + h);
      ctx.lineTo(x + w - 10, y + h / 2);
      break;
    case 'star': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const outer = Math.min(Math.abs(w), Math.abs(h)) / 2;
      const inner = outer / 2.5;
      for (let i = 0; i < 5; i += 1) {
        const outerAngle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const innerAngle = outerAngle + Math.PI / 5;
        const ox = cx + Math.cos(outerAngle) * outer;
        const oy = cy + Math.sin(outerAngle) * outer;
        const ix = cx + Math.cos(innerAngle) * inner;
        const iy = cy + Math.sin(innerAngle) * inner;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      break;
    }
    case 'diamond':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h);
      break;
    case 'check':
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x + w, y);
      break;
    default:
      ctx.rect(x, y, w, h);
      break;
  }
};

export const hitShape = (shape, point) => {
  const origin = getShapeOrigin(shape);
  const p = rotatePoint(point, origin, -(shape.rotation ?? 0));
  if (shape.type === 'circle') {
    const r = shape.radius ?? 10;
    return Math.hypot(p.x - shape.x, p.y - shape.y) <= r + 5;
  }
  const b = getShapeBounds(shape);
  if (!b) return false;
  if (STROKE_TYPES.has(shape.type)) {
    return (
      p.x >= b.x - 8 &&
      p.x <= b.x + b.width + 8 &&
      p.y >= b.y - 8 &&
      p.y <= b.y + b.height + 8
    );
  }
  return (
    p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
  );
};

export const selectionHandleAt = (shape, point, scale) => {
  if (!shape) return null;
  const b = getShapeBounds(shape);
  if (!b) return null;
  const origin = getShapeOrigin(shape);
  const p = rotatePoint(point, origin, -(shape.rotation ?? 0));
  const size = HANDLE_SIZE / scale;
  const handles = [
    { id: 'nw', x: b.x - 5, y: b.y - 5 },
    { id: 'ne', x: b.x + b.width + 5, y: b.y - 5 },
    { id: 'se', x: b.x + b.width + 5, y: b.y + b.height + 5 },
    { id: 'sw', x: b.x - 5, y: b.y + b.height + 5 },
    { id: 'rotate', x: b.x + b.width / 2, y: b.y - ROTATE_HANDLE_OFFSET },
  ];
  return (
    handles.find(
      (h) => Math.abs(p.x - h.x) <= size && Math.abs(p.y - h.y) <= size
    )?.id ?? null
  );
};

// MW - Converts a placed shape into stroke points, used when flattening a
// shape to the back of the underlayer.
export const shapeToStroke = (shape) => {
  const commands = [];
  const add = (x, y) => commands.push({ x, y });
  const b = getShapeBounds(shape);
  if (!b) return null;
  if (shape.type === 'circle') {
    for (let i = 0; i <= 48; i += 1) {
      const a = (i / 48) * Math.PI * 2;
      add(
        shape.x + Math.cos(a) * (shape.radius ?? 10),
        shape.y + Math.sin(a) * (shape.radius ?? 10)
      );
    }
    return {
      points: commands,
      colour: shape.colour ?? 'black',
      thickness: 2,
      isFilled: true,
    };
  }
  if (shape.type === 'text' || shape.type === 'icon') return null;
  const fake = {
    moveTo: add,
    lineTo: add,
    quadraticCurveTo: (_x1, _y1, x, y) => add(x, y),
    rect: (x, y, w, h) => {
      add(x, y);
      add(x + w, y);
      add(x + w, y + h);
      add(x, y + h);
      add(x, y);
    },
    closePath: () => {
      if (commands[0]) add(commands[0].x, commands[0].y);
    },
  };
  pathForShape(fake, shape);
  return {
    points: commands,
    colour: shape.colour ?? 'black',
    thickness: 2,
    isFilled: !STROKE_TYPES.has(shape.type),
  };
};

// MW - Flattens committed paint/highlighter/eraser strokes into one
// selectable path shape when the user switches away from a paint-like tool.
export const buildGroupedPathShape = (strokes, layerId) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pathSegments = [];
  for (const stroke of strokes) {
    const points = stroke.points ?? [];
    if (points.length === 0) continue;
    if (!stroke.isEraser) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const pad = Math.max((stroke.thickness ?? 1) / 2, 1);
      minX = Math.min(minX, Math.min(...xs) - pad);
      minY = Math.min(minY, Math.min(...ys) - pad);
      maxX = Math.max(maxX, Math.max(...xs) + pad);
      maxY = Math.max(maxY, Math.max(...ys) + pad);
    }
    pathSegments.push({
      pathSvg: pointsToSvgPath(points),
      colour: stroke.colour ?? 'black',
      thickness: stroke.thickness ?? 8,
      isEraser: !!stroke.isEraser,
      isFilled: !!stroke.isFilled,
      isHighlighter: !!stroke.isHighlighter,
    });
  }
  if (pathSegments.length === 0) return null;
  // MW - Nothing but eraser segments means there is no visible ink left,
  // so don't create/select an invisible shape.
  if (!pathSegments.some((segment) => !segment.isEraser)) return null;
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const firstVisibleSegment =
    pathSegments.find((segment) => !segment.isEraser) ?? pathSegments[0];
  const bounds = {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };

  return {
    id: makeId('path'),
    type: 'path',
    ...bounds,
    pathSvg: pathSegments.length === 1 ? pathSegments[0].pathSvg : null,
    pathSegments,
    pathBounds: bounds,
    colour: firstVisibleSegment.colour ?? 'black',
    thickness: firstVisibleSegment.thickness ?? 8,
    rotation: 0,
    layer: layerId,
  };
};

export const findTopShapeAt = (point, shapes, layers) => {
  const ordered = [];
  layers.forEach((layer) => {
    ordered.push(
      ...shapes.filter((shape) => getShapeLayer(shape) === layer.id)
    );
  });
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (hitShape(ordered[i], point)) return ordered[i];
  }
  return null;
};

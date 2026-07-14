import React from 'react';

import { getShapeAABB, getShapeLayer, PAPER_SIZE } from '../utils/shapeUtils';

const DEFAULT_LAYERS = [
  { id: 'underlayer', name: 'Under Paint' },
  { id: 'drawing', name: 'Drawing' },
  { id: 'shapes', name: 'Shapes' },
  { id: 'text', name: 'Text' },
];

const STROKE_TYPES = new Set(['line', 'arrow', 'cross', 'check']);
const PAINT_LIKE_TOOLS = new Set(['paint', 'highlighter', 'eraser']);
const COLOURABLE_TYPES = new Set(['text', 'icon', 'line']);
const HANDLE_SIZE = 8;
const ROTATE_HANDLE_OFFSET = 30;
const MAX_HISTORY = 50;
const HANDLE_CURSORS = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  rotate: 'grab',
};

const cloneShape = (shape) => ({ ...shape });
const cloneLayer = (layer) => ({ ...layer });
const cloneStroke = (stroke) => ({
  ...stroke,
  points: stroke.points?.map((p) => ({ ...p })) ?? [],
});
const makeId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const pointsToSvgPath = (points) => {
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

const buildGroupedPathShape = (strokes, layerId) => {
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

// MW - 50% alpha so a highlighter reads as translucent instead of opaque ink.
const withHighlighterAlpha = (colour) =>
  colour && colour.length === 7 && colour.startsWith('#')
    ? `${colour}80`
    : colour;

const isBrowser = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

const createMeasureContext = () => {
  if (!isBrowser()) return null;
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
};

const measureWebText = (content, fontSize) => {
  const ctx = createMeasureContext();
  if (!ctx)
    return { width: (content ?? '').length * fontSize * 0.6, height: fontSize };
  ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  return { width: ctx.measureText(content ?? '').width, height: fontSize };
};

const rotatePoint = (point, origin, degrees) => {
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

const getShapeBounds = (shape) => {
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

const getShapeOrigin = (shape) => {
  const b = getShapeBounds(shape);
  if (!b) return { x: 0, y: 0 };
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

const normalizeShape = (shape) => {
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

const pathForShape = (ctx, shape) => {
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

const drawStroke = (ctx, stroke) => {
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

const drawShape = (ctx, shape) => {
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
const shapeHasEraserSegments = (shape) =>
  shape.type === 'path' &&
  Array.isArray(shape.pathSegments) &&
  shape.pathSegments.some((segment) => segment.isEraser);

const drawShapeIsolated = (ctx, shape, width, height, bufferScale) => {
  const buffer = document.createElement('canvas');
  buffer.width = Math.max(1, Math.ceil(width * bufferScale));
  buffer.height = Math.max(1, Math.ceil(height * bufferScale));
  const bctx = buffer.getContext('2d');
  bctx.scale(bufferScale, bufferScale);
  drawShape(bctx, shape);
  ctx.drawImage(buffer, 0, 0, width, height);
};

const drawGrid = (ctx, width, height) => {
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

const drawRuler = (ctx, width, height, unit) => {
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

const drawSelection = (ctx, shape, scale) => {
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

const hitShape = (shape, point) => {
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

const selectionHandleAt = (shape, point, scale) => {
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

const shapeToStroke = (shape) => {
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

const TextEditor = ({
  visible,
  mode,
  value,
  onChange,
  onSubmit,
  onCancel,
  props,
}) => {
  if (!visible) return null;
  return (
    <div style={{ ...webStyles.modalOverlay, ...(props?.overlayStyle ?? {}) }}>
      <div
        style={{ ...webStyles.modalBackdrop, ...(props?.backdropStyle ?? {}) }}
        onMouseDown={onCancel}
      />
      <form
        style={{ ...webStyles.modalCard, ...(props?.cardStyle ?? {}) }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {props?.showHeader !== false && (
          <div
            style={{ ...webStyles.modalHeader, ...(props?.headerStyle ?? {}) }}
          >
            <span
              style={{
                ...webStyles.modalHeaderText,
                ...(props?.headerTextStyle ?? {}),
              }}
            >
              {mode === 'edit'
                ? (props?.editHeader ?? 'Edit text')
                : (props?.createHeader ?? 'Add text')}
            </span>
          </div>
        )}
        <label
          style={{ ...webStyles.modalTitle, ...(props?.titleStyle ?? {}) }}
        >
          {mode === 'edit'
            ? (props?.editTitle ?? 'Edit text')
            : (props?.createTitle ?? 'Add text')}
        </label>
        <textarea
          autoFocus={true}
          rows={props?.multiline === false ? 1 : 4}
          placeholder={props?.placeholder ?? 'Type something…'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...webStyles.textInput, ...(props?.inputStyle ?? {}) }}
        />
        <div
          style={{ ...webStyles.buttonRow, ...(props?.buttonRowStyle ?? {}) }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...webStyles.cancelButton,
              ...(props?.cancelButtonStyle ?? {}),
            }}
          >
            <span style={props?.cancelButtonTextStyle ?? undefined}>
              {props?.cancelLabel ?? 'Cancel'}
            </span>
          </button>
          <button
            type="submit"
            style={{
              ...webStyles.submitButton,
              ...(props?.submitButtonStyle ?? {}),
            }}
          >
            <span style={props?.submitButtonTextStyle ?? undefined}>
              {props?.submitLabel ?? 'Place'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};

const SkiaIllustratorWeb = React.forwardRef(
  (
    {
      canvasWidth = PAPER_SIZE.width,
      canvasHeight = PAPER_SIZE.height,
      imageSource = null,
      initialData = null,
      onToolChange = null,
      onSelectedShapeChange = null,
      onSave = null,
      textModalProps = null,
      style = null,
      className = undefined,
      active = true,
      enableEraseShape = false,
      defaultSettings = {
        tool: 'pen',
        brushSize: 8,
        fontSize: 32,
        brushColour: 'black',
        highlighterColour: 'yellow',
        shape: 'line',
        iconName: 'location-dot',
        showRuler: false,
        showGrid: false,
        viewPortSize: { width: 800, height: 800 },
      },
    },
    ref
  ) => {
    const hostRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const imageRef = React.useRef(null);
    const pointerRef = React.useRef(null);
    const undoRef = React.useRef([]);
    const redoRef = React.useRef([]);
    const clipboardRef = React.useRef(null);
    const stateRef = React.useRef(null);
    // MW - Last known canvas-space pointer position, used to draw the brush
    // size indicator for paint/highlighter without triggering a re-render.
    const hoverPointRef = React.useRef(null);

    const [viewportSize, setViewportSize] = React.useState({
      width: defaultSettings.viewPortSize?.width ?? 800,
      height: defaultSettings.viewPortSize?.height ?? 800,
    });
    const [resolvedCanvas, setResolvedCanvas] = React.useState({
      width: canvasWidth,
      height: canvasHeight,
    });
    const [currentTool, setCurrentToolState] = React.useState(
      defaultSettings.tool
    );
    const [currentColour, setCurrentColour] = React.useState(
      defaultSettings.brushColour
    );
    const [currentHighlighterColour, setCurrentHighlighterColour] =
      React.useState(defaultSettings.highlighterColour);
    const [brushSize, setBrushSizeState] = React.useState(
      defaultSettings.brushSize
    );
    const [fontSize, setFontSizeState] = React.useState(
      defaultSettings.fontSize
    );
    const [shapeToolType, setShapeToolType] = React.useState(
      defaultSettings.shape ?? null
    );
    const [activeIconData, setActiveIconData] = React.useState(null);
    const [defaultText, setDefaultText] = React.useState('');
    const [transform, setTransform] = React.useState({ scale: 1, x: 0, y: 0 });
    const [shapes, setShapes] = React.useState([]);
    const [strokes, setStrokes] = React.useState([]);
    const [layers, setLayers] = React.useState(DEFAULT_LAYERS.map(cloneLayer));
    const [activeLayerId, setActiveLayerId] = React.useState('shapes');
    const [selectedShapeId, setSelectedShapeId] = React.useState(null);
    const [showGrid, setShowGrid] = React.useState(
      defaultSettings.showGrid ?? false
    );
    const [showRuler, setShowRuler] = React.useState(
      defaultSettings.showRuler ?? false
    );
    const [rulerUnit, setRulerUnit] = React.useState('px');
    const [editor, setEditor] = React.useState({
      visible: false,
      mode: 'create',
      value: '',
      point: null,
      shapeId: null,
    });
    const [canvasReady, setCanvasReady] = React.useState(false);
    const [historySize, setHistorySize] = React.useState({ undo: 0, redo: 0 });

    stateRef.current = {
      currentTool,
      currentColour,
      currentHighlighterColour,
      brushSize,
      fontSize,
      shapeToolType,
      activeIconData,
      defaultText,
      transform,
      shapes,
      strokes,
      layers,
      activeLayerId,
      selectedShapeId,
      showGrid,
      showRuler,
      rulerUnit,
      resolvedCanvas,
      enableEraseShape,
    };

    const selectedShape = React.useMemo(
      () => shapes.find((shape) => shape.id === selectedShapeId) ?? null,
      [selectedShapeId, shapes]
    );

    const setCurrentTool = React.useCallback(
      (tool) => {
        setCurrentToolState(tool);
        onToolChange?.(tool);
      },
      [onToolChange]
    );

    React.useEffect(() => {
      onToolChange?.(currentTool);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
      onSelectedShapeChange?.(selectedShapeId != null);
    }, [selectedShapeId, onSelectedShapeChange]);

    // MW - Reset transient interaction state when this instance becomes
    // inactive (e.g. a tabbed host switching to a different illustrator).
    React.useEffect(() => {
      if (active) return;
      pointerRef.current = null;
      setEditor((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    }, [active]);

    React.useEffect(() => {
      stateRef.current = {
        currentTool,
        currentColour,
        currentHighlighterColour,
        brushSize,
        fontSize,
        shapeToolType,
        activeIconData,
        defaultText,
        transform,
        shapes,
        strokes,
        layers,
        activeLayerId,
        selectedShapeId,
        showGrid,
        showRuler,
        rulerUnit,
        resolvedCanvas,
        enableEraseShape,
      };
    }, [
      currentTool,
      currentColour,
      currentHighlighterColour,
      brushSize,
      fontSize,
      shapeToolType,
      activeIconData,
      defaultText,
      transform,
      shapes,
      strokes,
      layers,
      activeLayerId,
      selectedShapeId,
      showGrid,
      showRuler,
      rulerUnit,
      resolvedCanvas,
      enableEraseShape,
    ]);

    React.useEffect(() => {
      if (
        !hostRef.current ||
        typeof window === 'undefined' ||
        typeof window.ResizeObserver === 'undefined'
      )
        return undefined;
      const observer = new window.ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const next = {
          width: Math.max(1, Math.floor(entry.contentRect.width)),
          height: Math.max(1, Math.floor(entry.contentRect.height)),
        };
        setViewportSize(next);
        setCanvasReady(true);
      });
      observer.observe(hostRef.current);
      return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
      const FIT_MARGIN = 0.9;
      const fitScale =
        resolvedCanvas.width > 0 && resolvedCanvas.height > 0
          ? clamp(
              Math.min(
                viewportSize.width / resolvedCanvas.width,
                viewportSize.height / resolvedCanvas.height
              ) * FIT_MARGIN,
              0.1,
              12
            )
          : 1;
      setTransform({
        scale: fitScale,
        x: (viewportSize.width - resolvedCanvas.width * fitScale) / 2,
        y: (viewportSize.height - resolvedCanvas.height * fitScale) / 2,
      });
    }, [
      resolvedCanvas.width,
      resolvedCanvas.height,
      viewportSize.width,
      viewportSize.height,
    ]);

    React.useEffect(() => {
      if (!imageSource || !isBrowser()) {
        imageRef.current = null;
        setResolvedCanvas({ width: canvasWidth, height: canvasHeight });
        return undefined;
      }
      let cancelled = false;
      const img = new window.Image();
      img.onload = () => {
        if (cancelled) return;
        imageRef.current = img;
        setResolvedCanvas({
          width: img.naturalWidth || canvasWidth,
          height: img.naturalHeight || canvasHeight,
        });
      };
      img.onerror = () => {
        if (cancelled) return;
        imageRef.current = null;
        setResolvedCanvas({ width: canvasWidth, height: canvasHeight });
      };
      img.src = imageSource;
      return () => {
        cancelled = true;
      };
    }, [canvasWidth, canvasHeight, imageSource]);

    const buildSnapshot = React.useCallback(() => {
      const current = stateRef.current;
      return {
        shapes: current.shapes.map(cloneShape),
        strokes: current.strokes.map(cloneStroke),
        layers: current.layers.map(cloneLayer),
      };
    }, []);

    const pushHistory = React.useCallback(() => {
      undoRef.current.push(buildSnapshot());
      if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
      redoRef.current = [];
      setHistorySize({ undo: undoRef.current.length, redo: 0 });
    }, [buildSnapshot]);

    const restoreSnapshot = React.useCallback((snapshot) => {
      setShapes(snapshot.shapes.map(cloneShape));
      setStrokes(snapshot.strokes.map(cloneStroke));
      setLayers((snapshot.layers ?? DEFAULT_LAYERS).map(cloneLayer));
      setSelectedShapeId(null);
    }, []);

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

    const screenToCanvas = React.useCallback((clientX, clientY) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const current = stateRef.current;
      return {
        x:
          (clientX - rect.left - current.transform.x) / current.transform.scale,
        y: (clientY - rect.top - current.transform.y) / current.transform.scale,
      };
    }, []);

    // MW - Whether a canvas-space point sits on the paper. Paint strokes only
    // record on-paper samples so drawing outside the canvas leaves no marks.
    const isOnPaper = React.useCallback((point) => {
      const { width, height } = stateRef.current.resolvedCanvas;
      return (
        point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height
      );
    }, []);

    const findTopShape = React.useCallback(
      (
        point,
        sourceShapes = stateRef.current.shapes,
        sourceLayers = stateRef.current.layers
      ) => {
        const ordered = [];
        sourceLayers.forEach((layer) => {
          ordered.push(
            ...sourceShapes.filter((shape) => getShapeLayer(shape) === layer.id)
          );
        });
        for (let i = ordered.length - 1; i >= 0; i -= 1) {
          if (hitShape(ordered[i], point)) return ordered[i];
        }
        return null;
      },
      []
    );

    const updateSelectedBounds = React.useCallback((shape) => {
      setShapes((prev) =>
        prev.map((s) => (s.id === shape.id ? normalizeShape(shape) : s))
      );
    }, []);

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

    const submitEditor = React.useCallback(() => {
      const current = stateRef.current;
      const value = editor.value || null;

      if (value == null || value.trim() === '') {
        return;
      }

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
    }, [editor, pushHistory, setCurrentTool]);

    const addShapeAt = React.useCallback(
      (type, start, end = null) => {
        const current = stateRef.current;
        const defaultSize = Math.max(10, current.brushSize * 5);
        const width = end ? end.x - start.x : defaultSize;
        const height = end ? end.y - start.y : defaultSize;
        const id = makeId(type || 'shape');
        let shape;
        if (type === 'circle') {
          const radius = Math.max(
            4,
            Math.min(Math.abs(width), Math.abs(height)) / 2 || defaultSize / 2
          );
          shape = {
            id,
            type,
            x: start.x + radius,
            y: start.y + radius,
            radius,
            colour: current.currentColour,
            rotation: 0,
            layer: current.activeLayerId,
          };
        } else if (type === 'icon') {
          const iconData = current.activeIconData ?? {};
          const vb = iconData.iconViewBox ?? { width: 512, height: 512 };
          const ratio = vb.width > 0 ? vb.height / vb.width : 1;
          const w = width || defaultSize;
          shape = {
            id,
            type: 'icon',
            x: start.x,
            y: start.y,
            width: w,
            height: Math.abs(w) * ratio * (w < 0 ? -1 : 1),
            colour: current.currentColour,
            rotation: 0,
            layer: current.activeLayerId,
            iconName: iconData.iconName ?? '',
            iconPath: iconData.iconPath ?? '',
            iconViewBox: vb,
          };
        } else {
          shape = {
            id,
            type: type || 'rect',
            x: start.x,
            y: start.y,
            width,
            height,
            colour: current.currentColour,
            rotation: 0,
            layer: current.activeLayerId,
          };
        }
        pushHistory();
        setShapes([...current.shapes, normalizeShape(shape)]);
        setSelectedShapeId(id);
        setCurrentTool('control');
      },
      [pushHistory, setCurrentTool]
    );

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

    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;

      const handleWheel = (event) => {
        event.preventDefault();
        const current = stateRef.current;
        const rect = canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const before = {
          x: (sx - current.transform.x) / current.transform.scale,
          y: (sy - current.transform.y) / current.transform.scale,
        };
        const nextScale = clamp(
          current.transform.scale * (event.deltaY < 0 ? 1.1 : 0.9),
          0.1,
          12
        );
        setTransform({
          scale: nextScale,
          x: sx - before.x * nextScale,
          y: sy - before.y * nextScale,
        });
      };

      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }, []);

    const eraseShapesInSegment = React.useCallback((points, thickness) => {
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
    }, []);

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
      [pushHistory, eraseShapesInSegment]
    );

    const getHoverCursor = React.useCallback((point) => {
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
    }, []);

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
          current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          ) ?? null;
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
          setSelectedShapeId(hit.id);
          setEditor({
            visible: true,
            mode: 'edit',
            value: hit.content ?? '',
            point: null,
            shapeId: hit.id,
          });
          return;
        }

        if (current.currentTool === 'text') {
          if (hit?.type === 'text') {
            setSelectedShapeId(hit.id);
            setEditor({
              visible: true,
              mode: 'edit',
              value: hit.content ?? '',
              point: null,
              shapeId: hit.id,
            });
          } else addTextAt(point);
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
        eraseSegment,
        findTopShape,
        isOnPaper,
        pushHistory,
        renderCanvas,
        screenToCanvas,
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
            ? pointer.activeStroke.points[
                pointer.activeStroke.points.length - 1
              ]
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
          const nextShape = {
            ...pointer.startShape,
            x: pointer.startShape.x + dx,
            y: pointer.startShape.y + dy,
          };
          updateSelectedBounds(nextShape);
          return;
        }
        if (pointer.mode === 'rotate') {
          if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
          const angle =
            (Math.atan2(
              point.y - pointer.origin.y,
              point.x - pointer.origin.x
            ) *
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
        eraseSegment,
        getHoverCursor,
        isOnPaper,
        renderCanvas,
        screenToCanvas,
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
          const committed = cloneStroke(stroke);
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
            Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) >
            3;
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
      [addShapeAt, getHoverCursor, pushHistory, renderCanvas, screenToCanvas]
    );

    const onPointerLeave = React.useCallback(() => {
      hoverPointRef.current = null;
      renderCanvas();
    }, [renderCanvas]);

    const drawToContext = React.useCallback((ctx, width, height) => {
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
    }, []);

    const serializeCanvas = React.useCallback(() => {
      const current = stateRef.current;
      return JSON.stringify({
        version: 1,
        renderer: 'html-canvas',
        layers: current.layers.map(cloneLayer),
        shapes: current.shapes.map(cloneShape),
        strokes: current.strokes.map(cloneStroke),
      });
    }, []);

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
      [pushHistory]
    );

    React.useLayoutEffect(() => {
      if (initialData) loadCanvas(initialData);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
    }, [drawToContext]);

    const reorderShape = React.useCallback(
      (shapeId, direction, flattenAtBack = false) => {
        if (!shapeId) return;
        const current = stateRef.current;
        const idx = current.shapes.findIndex((shape) => shape.id === shapeId);
        if (idx === -1) return;
        const layer = getShapeLayer(current.shapes[idx]);
        const indices = current.shapes
          .map((shape, i) => (getShapeLayer(shape) === layer ? i : -1))
          .filter((i) => i !== -1);
        const pos = indices.indexOf(idx);
        let targetPos =
          direction === Infinity
            ? indices.length - 1
            : direction === -Infinity
              ? 0
              : pos + direction;
        targetPos = clamp(targetPos, 0, indices.length - 1);
        if (targetPos === pos) {
          if (flattenAtBack && pos === 0 && layer === 'underlayer') {
            const stroke = shapeToStroke(current.shapes[idx]);
            if (!stroke) return;
            pushHistory();
            setStrokes([...current.strokes, stroke]);
            setShapes(current.shapes.filter((shape) => shape.id !== shapeId));
            setSelectedShapeId(null);
          }
          return;
        }
        pushHistory();
        const next = [...current.shapes];
        const [shape] = next.splice(idx, 1);
        const insertBefore =
          indices[targetPos] > idx ? indices[targetPos] : indices[targetPos];
        next.splice(insertBefore, 0, shape);
        setShapes(next);
      },
      [pushHistory]
    );

    const onKeyDown = React.useCallback(
      (event) => {
        // MW - Modal open: don't let hotkeys interfere with typing.
        if (editor.visible) return;

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

          if (event.key === 'c') {
            setCurrentTool('control');
          }

          if (event.key === 'p') {
            setCurrentTool('paint');
          }

          if (event.key === 'h') {
            setCurrentTool('highlighter');
          }

          if (event.key === 't') {
            setCurrentTool('text');
          }

          if (event.key === 'l') {
            setCurrentTool('line');
          }

          if (event.key === 'i') {
            setCurrentTool('shape');
          }

          if (event.key === 'e') {
            setCurrentTool('eraser');
          }

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
          return;
        }
      },
      [pushHistory, undo, redo, onSave, setCurrentTool, editor.visible]
    );

    React.useImperativeHandle(
      ref,
      () => ({
        clearCanvas: () => {
          pushHistory();
          setShapes([]);
          setStrokes([]);
          setSelectedShapeId(null);
        },
        setCurrentTool: (tool) => {
          const current = stateRef.current;
          const leavingPaintLikeTool =
            PAINT_LIKE_TOOLS.has(current.currentTool) &&
            current.currentTool !== tool;

          if (
            leavingPaintLikeTool &&
            current.strokes.length > 0 &&
            !PAINT_LIKE_TOOLS.has(tool)
          ) {
            // MW - Leaving a paint-like tool collapses the committed strokes
            // into a single selectable/movable shape (mirrors native).
            const pathShape = buildGroupedPathShape(
              current.strokes,
              current.activeLayerId
            );
            if (pathShape) {
              pushHistory();
              setShapes([...current.shapes, pathShape]);
              setStrokes([]);
              if (tool === 'control') setSelectedShapeId(pathShape.id);
            }
          }
          setCurrentTool(tool);
        },
        getCurrentTool: () => stateRef.current.currentTool,
        setColour: (colour) => {
          setCurrentColour(colour);
          const current = stateRef.current;
          if (current.selectedShapeId) {
            pushHistory();
            setShapes(
              current.shapes.map((shape) =>
                shape.id === current.selectedShapeId
                  ? { ...shape, colour }
                  : shape
              )
            );
          }
        },
        getCurrentColour: () => stateRef.current.currentColour,
        setHighlighterColour: (colour) => {
          setCurrentHighlighterColour(colour);
        },
        getCurrentHighlighterColour: () =>
          stateRef.current.currentHighlighterColour,
        setBrushSize: (size) => {
          setBrushSizeState(size);
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || selected.type === 'text') return;
          pushHistory();
          const newSize = size * 5;
          const updated =
            selected.type === 'circle'
              ? { ...selected, radius: newSize / 2 }
              : {
                  ...selected,
                  width: newSize,
                  height:
                    newSize *
                    ((selected.height ?? newSize) /
                      (selected.width || newSize)),
                };
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id ? updated : shape
            )
          );
        },
        getCurrentBrushSize: () => stateRef.current.brushSize,
        saveCanvasAsImage,
        serializeCanvas,
        loadCanvas,
        setFontSize: (size) => {
          setFontSizeState(size);
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || selected.type !== 'text') return;
          pushHistory();
          const measured = measureWebText(selected.content ?? '', size);
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id
                ? {
                    ...shape,
                    fontSize: size,
                    width: measured.width,
                    height: measured.height,
                  }
                : shape
            )
          );
        },
        getCurrentFontSize: () => stateRef.current.fontSize,
        setText: (text) => {
          const value = text == null ? '' : String(text);
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (selected?.type === 'text') {
            pushHistory();
            const measured = measureWebText(
              value || ' ',
              selected.fontSize ?? current.fontSize
            );
            setShapes(
              current.shapes.map((shape) =>
                shape.id === selected.id
                  ? {
                      ...shape,
                      content: value,
                      width: measured.width,
                      height: measured.height,
                    }
                  : shape
              )
            );
          } else setDefaultText(value || 'New Text');
        },
        closeKeyboard: () => setEditor((prev) => ({ ...prev, visible: false })),
        deleteSelectedShape: () => {
          const current = stateRef.current;
          if (!current.selectedShapeId) return;
          pushHistory();
          setShapes(
            current.shapes.filter(
              (shape) => shape.id !== current.selectedShapeId
            )
          );
          setSelectedShapeId(null);
        },
        hasSelectedShape: () => stateRef.current.selectedShapeId != null,
        getSelectedType: () => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          return selected?.type ?? null;
        },
        getSelectedPosition: () => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected) return null;
          const b = getShapeBounds(selected);
          return { x: b.x, y: b.y };
        },
        setSelectedPosition: ({ x, y } = {}) => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || x == null || y == null) return;
          const b = getShapeBounds(selected);
          const dx = x - b.x;
          const dy = y - b.y;
          pushHistory();
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id
                ? { ...shape, x: shape.x + dx, y: shape.y + dy }
                : shape
            )
          );
        },
        getSelectedSize: () => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected) return null;
          const b = getShapeBounds(selected);
          return { width: b.width, height: b.height };
        },
        setSelectedSize: ({ width, height } = {}) => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || width == null || height == null) return;
          const b = getShapeBounds(selected);
          const nw = Math.max(1, width);
          const nh = Math.max(1, height);
          pushHistory();
          let updated;
          if (selected.type === 'circle') {
            updated = {
              ...selected,
              x: b.x + nw / 2,
              y: b.y + nh / 2,
              radius: Math.min(nw, nh) / 2,
            };
          } else if (selected.type === 'text') {
            const measured = measureWebText(selected.content ?? '', nh);
            updated = {
              ...selected,
              x: b.x,
              y: b.y + measured.height,
              width: measured.width,
              height: measured.height,
              fontSize: nh,
            };
          } else {
            updated = { ...selected, x: b.x, y: b.y, width: nw, height: nh };
          }
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id ? updated : shape
            )
          );
        },
        getColourOfSelected: () => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || !COLOURABLE_TYPES.has(selected.type)) return null;
          return selected.colour ?? null;
        },
        setColourForSelected: (colour) => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || !COLOURABLE_TYPES.has(selected.type)) return;
          pushHistory();
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id ? { ...shape, colour } : shape
            )
          );
        },
        setTextForSelected: () => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected || selected.type !== 'text') return;
          setEditor({
            visible: true,
            mode: 'edit',
            value: selected.content ?? '',
            point: null,
            shapeId: selected.id,
          });
        },
        duplicateSelectedShape: () => {
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (!selected) return null;
          pushHistory();
          const duplicate = {
            ...selected,
            id: makeId(selected.type ?? 'shape'),
            x: selected.x + 20,
            y: selected.y + 20,
          };
          setShapes([...current.shapes, duplicate]);
          setSelectedShapeId(duplicate.id);
          return duplicate.id;
        },
        setShape: (type) => {
          setShapeToolType(type);
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (current.currentTool === 'shape' && selected) {
            pushHistory();
            const b = getShapeBounds(selected);
            const updated =
              type === 'circle'
                ? {
                    ...selected,
                    type,
                    x: b.x + b.width / 2,
                    y: b.y + b.height / 2,
                    radius: Math.min(b.width, b.height) / 2,
                    width: undefined,
                    height: undefined,
                  }
                : {
                    ...selected,
                    type,
                    x: b.x,
                    y: b.y,
                    width: b.width,
                    height: b.height,
                    radius: undefined,
                    iconPath: undefined,
                    iconViewBox: undefined,
                    iconName: undefined,
                  };
            setShapes(
              current.shapes.map((shape) =>
                shape.id === selected.id ? updated : shape
              )
            );
          }
        },
        getCurrentShape: () => stateRef.current.shapeToolType,
        setIcon: (iconData) => {
          setActiveIconData(iconData);
          setShapeToolType('icon');
          const current = stateRef.current;
          const selected = current.shapes.find(
            (shape) => shape.id === current.selectedShapeId
          );
          if (current.currentTool === 'shape' && selected) {
            pushHistory();
            const b = getShapeBounds(selected);
            const vb = iconData?.iconViewBox ?? { width: 512, height: 512 };
            const updated = {
              ...selected,
              type: 'icon',
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.width * (vb.height / vb.width),
              radius: undefined,
              iconName: iconData?.iconName ?? '',
              iconPath: iconData?.iconPath ?? '',
              iconViewBox: vb,
            };
            setShapes(
              current.shapes.map((shape) =>
                shape.id === selected.id ? updated : shape
              )
            );
          }
        },
        undo,
        redo,
        canUndo: () => undoRef.current.length > 0,
        canRedo: () => redoRef.current.length > 0,
        clearSelection: () => setSelectedShapeId(null),
        getLayers: () => stateRef.current.layers.map(cloneLayer),
        addLayer: (name) => {
          const id = makeId('layer');
          setLayers((prev) => {
            const textIdx = prev.findIndex((layer) => layer.id === 'text');
            const next = [...prev];
            next.splice(textIdx === -1 ? prev.length : textIdx, 0, {
              id,
              name: name || 'Layer',
            });
            return next;
          });
          setActiveLayerId(id);
          return id;
        },
        removeLayer: (layerId) => {
          if (['underlayer', 'drawing', 'shapes', 'text'].includes(layerId))
            return;
          setLayers((prev) => prev.filter((layer) => layer.id !== layerId));
          setShapes((prev) =>
            prev.map((shape) =>
              shape.layer === layerId ? { ...shape, layer: 'shapes' } : shape
            )
          );
          setActiveLayerId((prev) => (prev === layerId ? 'shapes' : prev));
        },
        setActiveLayer: (layerId) => setActiveLayerId(layerId),
        getActiveLayer: () => stateRef.current.activeLayerId,
        moveShapeToLayer: (layerId, id) => {
          const current = stateRef.current;
          const shapeId = id ?? current.selectedShapeId;
          if (!shapeId) return;
          pushHistory();
          setShapes(
            current.shapes.map((shape) =>
              shape.id === shapeId ? { ...shape, layer: layerId } : shape
            )
          );
        },
        moveLayerUp: (layerId) => {
          pushHistory();
          setLayers((prev) => {
            const i = prev.findIndex((layer) => layer.id === layerId);
            if (i < 0 || i >= prev.length - 1) return prev;
            const next = [...prev];
            [next[i], next[i + 1]] = [next[i + 1], next[i]];
            return next;
          });
        },
        moveLayerDown: (layerId) => {
          pushHistory();
          setLayers((prev) => {
            const i = prev.findIndex((layer) => layer.id === layerId);
            if (i <= 0) return prev;
            const next = [...prev];
            [next[i], next[i - 1]] = [next[i - 1], next[i]];
            return next;
          });
        },
        bringShapeForward: (id) =>
          reorderShape(id ?? stateRef.current.selectedShapeId, 1),
        sendShapeBackward: (id) =>
          reorderShape(id ?? stateRef.current.selectedShapeId, -1, true),
        bringShapeToFront: (id) =>
          reorderShape(id ?? stateRef.current.selectedShapeId, Infinity),
        sendShapeToBack: (id) =>
          reorderShape(id ?? stateRef.current.selectedShapeId, -Infinity),
        setGridVisible: (visible) => setShowGrid(visible),
        isGridVisible: () => stateRef.current.showGrid,
        toggleGrid: () => setShowGrid((visible) => !visible),
        setRulerVisible: (visible) => setShowRuler(visible),
        isRulerVisible: () => stateRef.current.showRuler,
        toggleRuler: () => setShowRuler((visible) => !visible),
        setRulerUnit: (unit) => setRulerUnit(unit),
        getRulerUnit: () => stateRef.current.rulerUnit,
      }),
      [
        loadCanvas,
        pushHistory,
        redo,
        saveCanvasAsImage,
        serializeCanvas,
        setCurrentTool,
        reorderShape,
        undo,
      ]
    );

    return (
      <div
        ref={hostRef}
        className={className}
        style={{ ...webStyles.root, ...(style ?? {}) }}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        <canvas
          ref={canvasRef}
          style={webStyles.canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        />
        {!canvasReady && <div style={webStyles.loading}>Loading canvas…</div>}
        <TextEditor
          visible={editor.visible}
          mode={editor.mode}
          value={editor.value}
          onChange={(value) => setEditor((prev) => ({ ...prev, value }))}
          onSubmit={submitEditor}
          onCancel={() => setEditor((prev) => ({ ...prev, visible: false }))}
          props={textModalProps}
          autoFocus={true}
        />
        <span style={webStyles.historyStatus} aria-hidden="true">
          {historySize.undo}:{historySize.redo}
        </span>
      </div>
    );
  }
);

SkiaIllustratorWeb.displayName = 'SkiaIllustratorWeb';

const webStyles = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    minWidth: 1,
    minHeight: 1,
    overflow: 'hidden',
    outline: 'none',
    background: '#dfdfdf',
    touchAction: 'none',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
    cursor: 'crosshair',
    touchAction: 'none',
  },
  loading: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    color: '#334155',
    background: 'rgba(255,255,255,0.58)',
    font: '14px system-ui, sans-serif',
  },
  modalOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    zIndex: 5,
  },
  modalBackdrop: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(15,23,42,0.32)',
  },
  modalCard: {
    position: 'relative',
    zIndex: 1,
    width: 'min(420px, calc(100% - 32px))',
    padding: 18,
    borderRadius: 16,
    background: '#ffffff',
    boxShadow: '0 20px 60px rgba(15,23,42,0.22)',
    display: 'grid',
    gap: 12,
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  modalHeaderText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  modalTitle: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: 700,
  },
  textInput: {
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    padding: 12,
    font: '15px system-ui, sans-serif',
    outline: 'none',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    border: 0,
    borderRadius: 999,
    padding: '10px 16px',
    background: '#e2e8f0',
    color: '#0f172a',
    cursor: 'pointer',
  },
  submitButton: {
    border: 0,
    borderRadius: 999,
    padding: '10px 16px',
    background: '#6366f1',
    color: '#ffffff',
    cursor: 'pointer',
  },
  historyStatus: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
    pointerEvents: 'none',
  },
};

export default SkiaIllustratorWeb;

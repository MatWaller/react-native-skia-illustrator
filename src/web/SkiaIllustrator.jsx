import React from 'react';

import { getShapeAABB, getShapeLayer, PAPER_SIZE } from '../utils/shapeUtils';

const DEFAULT_LAYERS = [
  { id: 'underlayer', name: 'Under Paint' },
  { id: 'drawing', name: 'Drawing' },
  { id: 'shapes', name: 'Shapes' },
  { id: 'text', name: 'Text' },
];

const STROKE_TYPES = new Set(['line', 'arrow', 'cross', 'check']);
const HANDLE_SIZE = 8;
const ROTATE_HANDLE_OFFSET = 30;
const MAX_HISTORY = 50;

const cloneShape = (shape) => ({ ...shape });
const cloneLayer = (layer) => ({ ...layer });
const cloneStroke = (stroke) => ({
  ...stroke,
  points: stroke.points?.map((p) => ({ ...p })) ?? [],
});
const makeId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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
  if (shape.type === 'circle') return shape;
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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

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
          autoFocus={props?.autoFocus !== false}
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
      _showGrid = true,
      _showRuler = true,
      imageSource = null,
      initialData = null,
      onToolChange = null,
      onSelectedShapeChange = null,
      textModalProps = null,
      style = null,
      className = undefined,
    },
    ref
  ) => {
    const hostRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const imageRef = React.useRef(null);
    const pointerRef = React.useRef(null);
    const undoRef = React.useRef([]);
    const redoRef = React.useRef([]);
    const stateRef = React.useRef(null);

    const [viewportSize, setViewportSize] = React.useState({
      width: 800,
      height: 600,
    });
    const [resolvedCanvas, setResolvedCanvas] = React.useState({
      width: canvasWidth,
      height: canvasHeight,
    });
    const [currentTool, setCurrentToolState] = React.useState('control');
    const [currentColour, setCurrentColour] = React.useState('black');
    const [brushSize, setBrushSizeState] = React.useState(8);
    const [fontSize, setFontSizeState] = React.useState(32);
    const [shapeToolType, setShapeToolType] = React.useState(null);
    const [activeIconData, setActiveIconData] = React.useState(null);
    const [defaultText, setDefaultText] = React.useState('New Text');
    const [transform, setTransform] = React.useState({ scale: 1, x: 0, y: 0 });
    const [shapes, setShapes] = React.useState([]);
    const [strokes, setStrokes] = React.useState([]);
    const [layers, setLayers] = React.useState(DEFAULT_LAYERS.map(cloneLayer));
    const [activeLayerId, setActiveLayerId] = React.useState('shapes');
    const [selectedShapeId, setSelectedShapeId] = React.useState(null);
    const [showGrid, setShowGrid] = React.useState(_showGrid);
    const [showRuler, setShowRuler] = React.useState(_showRuler);
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

    React.useEffect(() => {
      stateRef.current = {
        currentTool,
        currentColour,
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
      };
    }, [
      currentTool,
      currentColour,
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
      const value = editor.value || ' ';
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
        setSelectedShapeId(shape.id);
      }
      setEditor((prev) => ({ ...prev, visible: false }));
    }, [editor, pushHistory]);

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
      },
      [pushHistory]
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

      layers.forEach((layer) => {
        if (layer.id === 'drawing') {
          const buffer = document.createElement('canvas');
          buffer.width = Math.max(1, Math.ceil(resolvedCanvas.width));
          buffer.height = Math.max(1, Math.ceil(resolvedCanvas.height));
          const bctx = buffer.getContext('2d');
          strokes.forEach((stroke) => drawStroke(bctx, stroke));
          const active = pointerRef.current?.activeStroke;
          if (active) drawStroke(bctx, active);
          ctx.drawImage(buffer, 0, 0);
        } else {
          shapes
            .filter((shape) => getShapeLayer(shape) === layer.id)
            .forEach((shape) => drawShape(ctx, shape));
        }
      });

      if (pointerRef.current?.pendingLine) {
        const p = pointerRef.current.pendingLine;
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 / transform.scale, 0, Math.PI * 2);
        ctx.fill();
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

    const onPointerDown = React.useCallback(
      (event) => {
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

        if (event.detail === 2 && hit?.type === 'text') {
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
          current.currentTool === 'eraser'
        ) {
          pointerRef.current = {
            mode: 'stroke',
            activeStroke: {
              points: [point],
              colour:
                current.currentTool === 'eraser'
                  ? 'black'
                  : current.currentColour,
              thickness: current.brushSize,
              isEraser: current.currentTool === 'eraser',
            },
          };
          renderCanvas();
          return;
        }

        if (
          current.currentTool === 'shape' &&
          current.shapeToolType &&
          !handle &&
          !hit
        ) {
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
        addShapeAt,
        addTextAt,
        findTopShape,
        pushHistory,
        renderCanvas,
        screenToCanvas,
      ]
    );

    const onPointerMove = React.useCallback(
      (event) => {
        const pointer = pointerRef.current;
        if (!pointer) return;
        const point = screenToCanvas(event.clientX, event.clientY);
        if (pointer.mode === 'stroke') {
          pointer.activeStroke.points.push(point);
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
          else if (shape.type === 'text')
            updateSelectedBounds({
              ...shape,
              x: nx,
              y: ny + nh,
              width: nw,
              height: nh,
              fontSize: Math.max(6, nh),
            });
          else
            updateSelectedBounds({
              ...shape,
              x: nx,
              y: ny,
              width: nw,
              height: nh,
            });
        }
      },
      [renderCanvas, screenToCanvas, updateSelectedBounds]
    );

    const onPointerUp = React.useCallback(
      (event) => {
        const pointer = pointerRef.current;
        if (!pointer) return;
        const current = stateRef.current;
        const point = screenToCanvas(event.clientX, event.clientY);
        if (pointer.mode === 'stroke') {
          const stroke = pointer.activeStroke;
          const hitIds = [];
          if (stroke.isEraser) {
            const xs = stroke.points.map((p) => p.x);
            const ys = stroke.points.map((p) => p.y);
            const box = {
              x: Math.min(...xs) - stroke.thickness / 2,
              y: Math.min(...ys) - stroke.thickness / 2,
              width: Math.max(...xs) - Math.min(...xs) + stroke.thickness,
              height: Math.max(...ys) - Math.min(...ys) + stroke.thickness,
            };
            current.shapes.forEach((shape) => {
              const aabb = getShapeAABB(shape);
              if (
                aabb.x < box.x + box.width &&
                aabb.x + aabb.width > box.x &&
                aabb.y < box.y + box.height &&
                aabb.y + aabb.height > box.y
              )
                hitIds.push(shape.id);
            });
          }
          pushHistory();
          setStrokes([...current.strokes, cloneStroke(stroke)]);
          if (hitIds.length) {
            setShapes(
              current.shapes.filter((shape) => !hitIds.includes(shape.id))
            );
            if (hitIds.includes(current.selectedShapeId))
              setSelectedShapeId(null);
          }
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
        pointerRef.current = pointer.pendingLine
          ? { pendingLine: pointer.pendingLine }
          : null;
      },
      [addShapeAt, pushHistory, renderCanvas, screenToCanvas]
    );

    const onKeyDown = React.useCallback(
      (event) => {
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
        }
      },
      [pushHistory]
    );

    const drawToContext = React.useCallback((ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      if (imageRef.current)
        ctx.drawImage(imageRef.current, 0, 0, width, height);
      stateRef.current.layers.forEach((layer) => {
        if (layer.id === 'drawing')
          stateRef.current.strokes.forEach((stroke) => drawStroke(ctx, stroke));
        else
          stateRef.current.shapes
            .filter((shape) => getShapeLayer(shape) === layer.id)
            .forEach((shape) => drawShape(ctx, shape));
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

    React.useImperativeHandle(
      ref,
      () => ({
        clearCanvas: () => {
          pushHistory();
          setShapes([]);
          setStrokes([]);
          setSelectedShapeId(null);
        },
        setCurrentTool,
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
        deletedSelectedShape: () => {
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

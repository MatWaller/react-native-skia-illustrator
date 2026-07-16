// MW - Shared constants and tiny helpers used across the web illustrator.

export const DEFAULT_LAYERS = [
  { id: 'underlayer', name: 'Under Paint' },
  { id: 'drawing', name: 'Drawing' },
  { id: 'shapes', name: 'Shapes' },
  { id: 'text', name: 'Text' },
];

export const STROKE_TYPES = new Set(['line', 'arrow', 'cross', 'check']);
export const PAINT_LIKE_TOOLS = new Set([
  'paint',
  'paint-straight',
  'highlighter',
  'eraser',
]);
export const COLOURABLE_TYPES = new Set(['text', 'icon', 'line']);
export const HANDLE_SIZE = 8;
export const ROTATE_HANDLE_OFFSET = 30;
export const MAX_HISTORY = 50;
export const HANDLE_CURSORS = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  rotate: 'grab',
};

export const cloneShape = (shape) => ({ ...shape });
export const cloneLayer = (layer) => ({ ...layer });
export const cloneStroke = (stroke) => ({
  ...stroke,
  points: stroke.points?.map((p) => ({ ...p })) ?? [],
});

export const makeId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

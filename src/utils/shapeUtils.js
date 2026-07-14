// MW - Derive which layer a shape belongs to. Shapes with an explicit 'layer'
export const getShapeLayer = (shape) => {
  if (shape.layer) return shape.layer;
  return shape.type === 'text' ? 'text' : 'shapes';
};

// MW - Unrotated bounds in the shape's own local space (top-left x/y +
// width/height), used for get/set position & size APIs and resize handles.
export const getUnrotatedShapeBounds = (shape) => {
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

// MW - Axis-aligned bounding box for any shape, used for eraser hit testing.
export const getShapeAABB = (shape) => {
  const { x, y, type, rotation = 0 } = shape;
  const w = shape.width ?? 0;
  const h = shape.height ?? shape.fontSize ?? 0;
  if (type === 'circle') {
    const r = shape.radius ?? 10;
    return { x: x - r, y: y - r, width: r * 2, height: r * 2 };
  }
  if (type === 'text') {
    return { x, y: y - h, width: w, height: h };
  }
  // MW - Normalise negative dimensions (lines can be drawn right→left or
  // bottom→top, giving signed width/height) so the AABB is always valid.
  const nx = w < 0 ? x + w : x;
  const ny = h < 0 ? y + h : y;
  const nw = Math.abs(w);
  const nh = Math.abs(h);
  if (!rotation) return { x: nx, y: ny, width: nw, height: nh };
  // MW - For rotated shapes, compute the axis-aligned bounding box of the four corners (Massively overkill for the eraser, but it's a one-time calculation per shape and avoids any Skia calls).
  const cx = nx + nw / 2;
  const cy = ny + nh / 2;
  const θ = (rotation * Math.PI) / 180;
  const cosA = Math.cos(θ);
  const sinA = Math.sin(θ);
  const corners = [
    [nx, ny],
    [nx + nw, ny],
    [nx + nw, ny + nh],
    [nx, ny + nh],
  ].map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return [cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA];
  });
  const xs = corners.map(([px]) => px);
  const ys = corners.map(([, py]) => py);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

// MW - Build a flat SVG path string for a shape with rotation baked in so it
// can be stored as a committed drawing-layer stroke without a Group transform.
// Returns null for circles (caller should use path.addCircle instead).
export const buildFlattenedPath = (shape) => {
  const { x, y, type, rotation = 0 } = shape;
  const w = shape.width ?? 0;
  const h = shape.height ?? shape.fontSize ?? 0;
  const θ = (rotation * Math.PI) / 180;
  const cosA = Math.cos(θ);
  const sinA = Math.sin(θ);
  // Pivot mirrors ShapeNode origin: text pivots around its visual centre
  // (x + w/2, y - h/2); everything else around (x + w/2, y + h/2).
  const cx = x + w / 2;
  const cy = type === 'text' ? y - h / 2 : y + h / 2;
  const rot = (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    return `${cx + dx * cosA - dy * sinA},${cy + dx * sinA + dy * cosA}`;
  };
  if (type === 'circle') return null;
  if (type === 'text')
    return `M${rot(x, y - h)} L${rot(x + w, y - h)} L${rot(x + w, y)} L${rot(x, y)} Z`;
  if (type === 'rect' || type === 'roundedRect' || !type)
    return `M${rot(x, y)} L${rot(x + w, y)} L${rot(x + w, y + h)} L${rot(x, y + h)} Z`;
  if (type === 'line') return `M${rot(x, y)} L${rot(x + w, y + h)}`;
  if (type === 'triangle')
    return `M${rot(x, y + h)} L${rot(x + w / 2, y)} L${rot(x + w, y + h)} Z`;
  if (type === 'arrow') {
    return (
      `M${rot(x, y + h / 2)} L${rot(x + w - 10, y + h / 2)} ` +
      `L${rot(x + w - 10, y)} L${rot(x + w, y + h / 2)} ` +
      `L${rot(x + w - 10, y + h)} L${rot(x + w - 10, y + h / 2)}`
    );
  }
  if (type === 'star') {
    const scx = x + w / 2;
    const scy = y + h / 2;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR / 2.5;
    let d = '';
    for (let i = 0; i < 5; i++) {
      const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const ox = scx + Math.cos(angle) * outerR;
      const oy = scy + Math.sin(angle) * outerR;
      d += i === 0 ? `M${rot(ox, oy)} ` : `L${rot(ox, oy)} `;
      const ix = scx + Math.cos(angle + Math.PI / 5) * innerR;
      const iy = scy + Math.sin(angle + Math.PI / 5) * innerR;
      d += `L${rot(ix, iy)} `;
    }
    return d + 'Z';
  }
  if (type === 'diamond')
    return `M${rot(x + w / 2, y)} L${rot(x + w, y + h / 2)} L${rot(x + w / 2, y + h)} L${rot(x, y + h / 2)} Z`;
  if (type === 'cross')
    return `M${rot(x, y)} L${rot(x + w, y + h)} M${rot(x + w, y)} L${rot(x, y + h)}`;
  if (type === 'check')
    return `M${rot(x, y + h / 2)} L${rot(x + w / 2, y + h)} L${rot(x + w, y)}`;
  // Fallback: bounding box rect
  return `M${rot(x, y)} L${rot(x + w, y)} L${rot(x + w, y + h)} L${rot(x, y + h)} Z`;
};

export const PAPER_SIZE = { width: 200, height: 200 };

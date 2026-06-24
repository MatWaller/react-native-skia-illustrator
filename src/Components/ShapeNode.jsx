import React from 'react';
import { useDerivedValue } from 'react-native-reanimated';
import {
  Group,
  Rect,
  Circle,
  Path,
  Text,
  Skia,
} from '@shopify/react-native-skia';

// MW - Build the system typeface once and share it across every ShapeNode.
// Resolving a typeface via FontMgr.System() is relatively expensive; doing it
// per node on mount was a noticeable cost when placing text. Cache it lazily.
// The per-shape font (sized from shape.fontSize) is derived on the UI thread.
let sharedTypeface = null;
export const getSharedTypeface = () => {
  if (!sharedTypeface) {
    const fontMgr = Skia.FontMgr.System();
    const familyName = fontMgr.getFamilyName(0);
    sharedTypeface = fontMgr.matchFamilyStyle(familyName, {});
  }
  return sharedTypeface;
};

// MW - Measure the real rendered width of a string at a given font size using
// the shared system typeface. Selection bounds, hit-tests and rotation pivots
// all rely on this so the box hugs the glyphs exactly; the old
// `content.length * fontSize * 0.6` estimate ran wide and pushed the box to the
// right. Runs on the JS thread (where the cached typeface lives).
export const measureText = (content, fontSize) => {
  const font = Skia.Font(getSharedTypeface(), fontSize);
  return { width: font.getTextWidth(content ?? ''), height: fontSize };
};

export const ShapeNode = ({ shapeID, shapes, shapeSnapshot }) => {
  const typeface = getSharedTypeface();

  // MW - Choose the render branch (rect/circle/text) from the React-side shape
  // snapshot that mounted this node. This avoids reading `shapes.value` back
  // during the addText render, which can be one shared-value update behind and
  // would mount the previous text node instead of the one just created.
  const currentShape =
    shapeSnapshot ?? shapes.value.find((s) => s.id === shapeID);
  const shapeType = currentShape ? currentShape.type : 'rect';
  const textContent = currentShape?.content ?? '';
  const textFont = React.useMemo(
    () => Skia.Font(typeface, currentShape?.fontSize ?? 32),
    [currentShape?.fontSize, typeface]
  );

  // MW - Resolve this node's shape from the shared array exactly once per
  // update. Every visual property below reads from this single derived value
  // instead of running its own shapes.value.find(), which turned each shape
  // update into O(props x shapeCount) array scans.
  const shapeData = useDerivedValue(
    () => shapes.value.find((s) => s.id === shapeID) ?? null
  );

  const x = useDerivedValue(() => {
    const shape = shapeData.value;
    return shape ? shape.x : 0;
  });
  const y = useDerivedValue(() => {
    const shape = shapeData.value;
    return shape ? shape.y : 0;
  });
  const width = useDerivedValue(() => {
    const shape = shapeData.value;
    return shape ? (shape.width ?? 0) : 0;
  });
  const height = useDerivedValue(() => {
    const shape = shapeData.value;
    return shape ? (shape.height ?? 0) : 0;
  });
  const radius = useDerivedValue(() => {
    const shape = shapeData.value;
    return shape ? (shape.radius ?? 10) : 10;
  });
  const colour = useDerivedValue(() => {
    const shape = shapeData.value;
    return shape ? (shape.colour ?? 'black') : 'black';
  });

  const linePath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    return `M${sx},${sy} L${sx + sw},${sy + sh}`;
  });

  const trianglePath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    return `M${sx},${sy + sh} L${sx + sw / 2},${sy} L${sx + sw},${sy + sh} Z`;
  });

  const arrowPath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    return `M${sx},${sy + sh / 2} L${sx + sw - 10},${sy + sh / 2} L${sx + sw - 10},${sy} L${sx + sw},${sy + sh / 2} L${sx + sw - 10},${sy + sh} L${sx + sw - 10},${sy + sh / 2}`;
  });

  const starPath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    const cx = sx + sw / 2;
    const cy = sy + sh / 2;
    const spikes = 5;
    const outerRadius = Math.min(sw, sh) / 2;
    const innerRadius = outerRadius / 2.5;
    let path = '';
    for (let i = 0; i < spikes; i++) {
      const angle = (i * 2 * Math.PI) / spikes - Math.PI / 2;
      const xOuter = cx + Math.cos(angle) * outerRadius;
      const yOuter = cy + Math.sin(angle) * outerRadius;
      path += i === 0 ? `M${xOuter},${yOuter} ` : `L${xOuter},${yOuter} `;
      const xInner = cx + Math.cos(angle + Math.PI / spikes) * innerRadius;
      const yInner = cy + Math.sin(angle + Math.PI / spikes) * innerRadius;
      path += `L${xInner},${yInner} `;
    }
    return path + 'Z';
  });

  const diamondPath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    return `M${sx + sw / 2},${sy} L${sx + sw},${sy + sh / 2} L${sx + sw / 2},${sy + sh} L${sx},${sy + sh / 2} Z`;
  });

  const crossPath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    return `M${sx},${sy} L${sx + sw},${sy + sh} M${sx + sw},${sy} L${sx},${sy + sh}`;
  });

  const checkPath = useDerivedValue(() => {
    const sx = x.value;
    const sy = y.value;
    const sw = width.value;
    const sh = height.value;
    return `M${sx},${sy + sh / 2} L${sx + sw / 2},${sy + sh} L${sx + sw},${sy}`;
  });

  const origin = useDerivedValue(() => {
    const shape = shapeData.value;
    if (!shape) return { x: 0, y: 0 };

    // MW - Pivot rotation around each shape's true visual centre so it spins in
    // place. The centre differs per type: circles draw from their centre point,
    // and text draws from its baseline (extending right and up), so neither
    // matches the stored width/height box used by rectangles.
    if (shape.type === 'circle') {
      return { x: shape.x, y: shape.y };
    }
    if (shape.type === 'text') {
      const w = shape.width ?? 0;
      const h = shape.height ?? shape.fontSize ?? 32;
      return { x: shape.x + w / 2, y: shape.y - h / 2 };
    }
    return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  });

  const transform = useDerivedValue(() => {
    const shape = shapeData.value;
    // MW - When the shape has been removed from shapes.value but the React
    // ShapeNode hasn't unmounted yet (one-frame gap), collapse to invisible so
    // icons and other shapes don't flash at default/identity-matrix scale.
    if (!shape) return [{ scale: 0 }];
    return [{ rotate: ((shape.rotation ?? 0) * Math.PI) / 180 }];
  });

  // MW - FontAwesome Support :)
  const iconSkiaPath = React.useMemo(() => {
    if (!currentShape?.iconPath) return null;
    return Skia.Path.MakeFromSVGString(currentShape.iconPath);
  }, [currentShape?.iconPath]);

  const iconMatrix = useDerivedValue(() => {
    const shape = shapeData.value;
    if (!shape || shape.type !== 'icon') return Skia.Matrix();
    const vbW = shape.iconViewBox?.width ?? 512;
    const vbH = shape.iconViewBox?.height ?? 512;
    const sx = (shape.width ?? vbW) / vbW;
    const sy = (shape.height ?? vbH) / vbH;
    const m = Skia.Matrix();
    m.translate(shape.x, shape.y);
    m.scale(sx, sy);
    return m;
  });

  if (shapeType === 'icon') {
    if (!iconSkiaPath) return null;
    return (
      <Group origin={origin} transform={transform}>
        <Group matrix={iconMatrix}>
          <Path path={iconSkiaPath} color={colour} />
        </Group>
      </Group>
    );
  }

  if (shapeType === 'rect') {
    return (
      <Group origin={origin} transform={transform}>
        <Rect x={x} y={y} width={width} height={height} color={colour} />
      </Group>
    );
  }

  if (shapeType === 'line') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={linePath} color={colour} style="stroke" strokeWidth={2} />
      </Group>
    );
  }

  if (shapeType === 'circle') {
    return (
      <Group origin={origin} transform={transform}>
        <Circle cx={x} cy={y} r={radius} color={colour} />
      </Group>
    );
  }

  if (shapeType === 'triangle') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={trianglePath} color={colour} />
      </Group>
    );
  }

  if (shapeType === 'text') {
    return (
      <Group origin={origin} transform={transform}>
        <Text x={x} y={y} text={textContent} color={colour} font={textFont} />
      </Group>
    );
  }

  if (shapeType === 'arrow') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={arrowPath} color={colour} style="stroke" strokeWidth={2} />
      </Group>
    );
  }

  if (shapeType === 'star') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={starPath} color={colour} />
      </Group>
    );
  }

  if (shapeType === 'diamond') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={diamondPath} color={colour} />
      </Group>
    );
  }

  if (shapeType === 'cross') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={crossPath} color={colour} style="stroke" strokeWidth={2} />
      </Group>
    );
  }

  if (shapeType === 'check') {
    return (
      <Group origin={origin} transform={transform}>
        <Path path={checkPath} color={colour} style="stroke" strokeWidth={2} />
      </Group>
    );
  }

  return null;
};

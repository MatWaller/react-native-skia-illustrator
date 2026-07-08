import React from 'react';
import {
  useDerivedValue,
  useSharedValue,
  useAnimatedReaction,
} from 'react-native-reanimated';
import {
  Group,
  Rect,
  Circle,
  Path,
  Paint,
  Text,
  Skia,
} from '@shopify/react-native-skia';

// MW - Build the system typeface once and share it across every ShapeNode.
// Resolving a typeface via FontMgr.System() is relatively expensive; doing it
// per node on mount was a noticeable cost when placing text. Cache it lazily.
// The per-shape font (sized from shape.fontSize) is derived on the UI thread.
let sharedTypeface = null;
export const getSharedTypeface = () => {
  if (sharedTypeface === null) {
    const fontMgr = Skia.FontMgr.System();
    if (!fontMgr) return null;
    const familyName = fontMgr.getFamilyName(0);
    sharedTypeface = familyName
      ? fontMgr.matchFamilyStyle(familyName, {})
      : null;
  }
  return sharedTypeface;
};

// MW - Measure the real rendered width of a string at a given font size using
// the shared system typeface. Selection bounds, hit-tests and rotation pivots
// all rely on this so the box hugs the glyphs exactly; the old
// `content.length * fontSize * 0.6` estimate ran wide and pushed the box to the
// right. Runs on the JS thread (where the cached typeface lives).
export const measureText = (content, fontSize) => {
  const typeface = getSharedTypeface();
  if (!typeface) {
    return { width: (content ?? '').length * fontSize * 0.6, height: fontSize };
  }
  const font = Skia.Font(typeface, fontSize);
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

  // MW - Mirror this node's live geometry into individual PRIMITIVE shared
  // values via a single useAnimatedReaction. The previous design resolved the
  // shape through an intermediate object-returning useDerivedValue (`shapeData`)
  // and read `shapeData.value.x` etc. downstream. Gesture handlers mutate the
  // shape object IN PLACE and then reassign `shapes.value`, so that
  // intermediate derived value resolved to the SAME object reference every
  // frame. Reanimated short-circuits a derived value whose output is
  // reference-equal, so the downstream x/y/width/rotation derived values never
  // re-ran during a drag — the shape only jumped to its new position on the
  // next React render (e.g. when the selection was cleared), while the
  // selection outline (fed a brand-new bounds object each frame) tracked the
  // finger. Writing primitives from a reaction (which fires on every `shapes`
  // change, with no reference-equality skip) makes the shape track the gesture
  // in real time.
  const x = useSharedValue(currentShape?.x ?? 0);
  const y = useSharedValue(currentShape?.y ?? 0);
  const width = useSharedValue(currentShape?.width ?? 0);
  const height = useSharedValue(currentShape?.height ?? 0);
  const radius = useSharedValue(currentShape?.radius ?? 10);
  const colour = useSharedValue(currentShape?.colour ?? 'black');
  const rotation = useSharedValue(currentShape?.rotation ?? 0);
  const fontSize = useSharedValue(currentShape?.fontSize ?? 32);
  const thickness = useSharedValue(currentShape?.thickness ?? 8);
  const exists = useSharedValue(!!currentShape);

  useAnimatedReaction(
    () => shapes.value.find((s) => s.id === shapeID) ?? null,
    (shape) => {
      if (!shape) {
        exists.value = false;
        return;
      }
      exists.value = true;
      x.value = shape.x;
      y.value = shape.y;
      width.value = shape.width ?? 0;
      height.value = shape.height ?? 0;
      radius.value = shape.radius ?? 10;
      colour.value = shape.colour ?? 'black';
      rotation.value = shape.rotation ?? 0;
      fontSize.value = shape.fontSize ?? 32;
      thickness.value = shape.thickness ?? 8;
    },
    [shapeID]
  );

  // MW - Build the text font on the UI thread from the live `fontSize` shared
  // value so glyphs scale in real time during a pinch resize. A React-side
  // useMemo (the previous approach) only rebuilt the font on re-render, so the
  // text stayed the same size while the selection box grew/shrank under the
  // gesture.
  const textFont = useDerivedValue(() =>
    typeface ? Skia.Font(typeface, fontSize.value || 32) : null
  );

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
    // MW - Pivot rotation around each shape's true visual centre so it spins in
    // place. The centre differs per type: circles draw from their centre point,
    // and text draws from its baseline (extending right and up), so neither
    // matches the stored width/height box used by rectangles.
    if (shapeType === 'circle') {
      return { x: x.value, y: y.value };
    }
    if (shapeType === 'text') {
      const h = height.value || currentShape?.fontSize || 32;
      return { x: x.value + width.value / 2, y: y.value - h / 2 };
    }
    return { x: x.value + width.value / 2, y: y.value + height.value / 2 };
  });

  const transform = useDerivedValue(() => {
    // MW - When the shape has been removed from shapes.value but the React
    // ShapeNode hasn't unmounted yet (one-frame gap), collapse to invisible so
    // icons and other shapes don't flash at default/identity-matrix scale.
    if (!exists.value) return [{ scale: 0 }];
    return [{ rotate: (rotation.value * Math.PI) / 180 }];
  });

  // MW - FontAwesome Support :)
  const iconSkiaPath = React.useMemo(() => {
    if (!currentShape?.iconPath) return null;
    return Skia.Path.MakeFromSVGString(currentShape.iconPath);
  }, [currentShape?.iconPath]);

  const iconMatrix = useDerivedValue(() => {
    if (shapeType !== 'icon') return Skia.Matrix();
    const vbW = currentShape?.iconViewBox?.width ?? 512;
    const vbH = currentShape?.iconViewBox?.height ?? 512;
    const sx = (width.value || vbW) / vbW;
    const sy = (height.value || vbH) / vbH;
    const m = Skia.Matrix();
    m.translate(x.value, y.value);
    m.scale(sx, sy);
    return m;
  });

  const customPathSegments = React.useMemo(() => {
    if (currentShape?.pathSegments?.length) {
      return currentShape.pathSegments
        .map((segment) => ({
          ...segment,
          path: segment.pathSvg
            ? Skia.Path.MakeFromSVGString(segment.pathSvg)
            : null,
        }))
        .filter((segment) => segment.path);
    }

    if (!currentShape?.pathSvg) return [];
    const path = Skia.Path.MakeFromSVGString(currentShape.pathSvg);
    return path
      ? [
          {
            path,
            colour: currentShape.colour,
            thickness: currentShape.thickness,
            isEraser: false,
            isFilled: false,
            isHighlighter: false,
          },
        ]
      : [];
  }, [
    currentShape?.colour,
    currentShape?.pathSegments,
    currentShape?.pathSvg,
    currentShape?.thickness,
  ]);

  const customPathMatrix = useDerivedValue(() => {
    if (shapeType !== 'path') return Skia.Matrix();
    const source = currentShape?.pathBounds ?? {
      x: currentShape?.x ?? 0,
      y: currentShape?.y ?? 0,
      width: currentShape?.width ?? 1,
      height: currentShape?.height ?? 1,
    };
    const sourceWidth = source.width || 1;
    const sourceHeight = source.height || 1;
    const m = Skia.Matrix();
    m.translate(x.value, y.value);
    m.scale(width.value / sourceWidth, height.value / sourceHeight);
    m.translate(-(source.x ?? 0), -(source.y ?? 0));
    return m;
  });

  if (shapeType === 'path') {
    if (customPathSegments.length === 0) return null;
    const hasEraser = customPathSegments.some((segment) => segment.isEraser);
    return (
      <Group origin={origin} transform={transform}>
        <Group
          matrix={customPathMatrix}
          layer={hasEraser ? <Paint /> : undefined}
        >
          {customPathSegments.map((segment, index) => (
            <Path
              key={index}
              path={segment.path}
              color={segment.colour ?? colour}
              style={segment.isFilled ? 'fill' : 'stroke'}
              strokeWidth={segment.thickness ?? thickness}
              strokeCap={segment.isHighlighter ? 'square' : 'round'}
              strokeJoin={segment.isHighlighter ? 'miter' : 'round'}
              blendMode={segment.isEraser ? 'clear' : 'srcOver'}
            />
          ))}
        </Group>
      </Group>
    );
  }

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
    if (!typeface) return null;
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

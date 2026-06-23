import React, { useMemo } from 'react';
import { Group, Path, Rect, Text, Skia } from '@shopify/react-native-skia';
import { getSharedTypeface } from './ShapeNode';

// MW - Thickness (in canvas px) of each ruler bar.
export const RULER_SIZE = 20;

// MW - Standard screen density: 96 px per inch → 1 cm ≈ 37.795 px.
const CM_TO_PX = 37.795;
const FONT_SIZE = 7;

// MW - Tick heights as a fraction of RULER_SIZE.
const MAJOR_TICK = RULER_SIZE * 0.65;
const MID_TICK = RULER_SIZE * 0.4;
const MINOR_TICK = RULER_SIZE * 0.2;

/**
 * Return { interval, mid, minor, toLabel } for the chosen unit.
 * interval – distance between major ticks (paper px)
 * mid      – distance between mid ticks
 * minor    – distance between minor ticks
 * toLabel  – fn(tickValue) → display string
 */
function getTickConfig(unit) {
  if (unit === 'cm') {
    return {
      interval: CM_TO_PX, // 1 cm
      mid: CM_TO_PX / 2, // 0.5 cm
      minor: CM_TO_PX / 10, // 0.1 cm
      toLabel: (v) => `${Math.round(v / CM_TO_PX)}`,
    };
  }
  // 'px' default
  return {
    interval: 100,
    mid: 50,
    minor: 10,
    toLabel: (v) => `${Math.round(v)}`,
  };
}

/**
 * Build tick paths and label arrays for both rulers.
 */
function buildRuler(canvasWidth, canvasHeight, unit) {
  const cfg = getTickConfig(unit);
  const SNAP = 0.5; // px tolerance for modulo comparisons

  const path = Skia.Path.Make();
  const hLabels = []; // { x, y, text } — horizontal ruler labels
  const vLabels = []; // { x, y, text } — vertical ruler labels

  // ── Horizontal ruler (top edge, y ∈ [-RULER_SIZE, 0]) ──────────────────
  for (let x = 0; x <= canvasWidth; x += cfg.minor) {
    const rounded = Math.round(x);
    const isMajor =
      rounded % Math.round(cfg.interval) < SNAP ||
      rounded % Math.round(cfg.interval) > Math.round(cfg.interval) - SNAP;
    const isMid =
      !isMajor &&
      (rounded % Math.round(cfg.mid) < SNAP ||
        rounded % Math.round(cfg.mid) > Math.round(cfg.mid) - SNAP);

    const tickH = isMajor ? MAJOR_TICK : isMid ? MID_TICK : MINOR_TICK;
    // Ticks grow downward from the top of the ruler bar.
    path.moveTo(x, -RULER_SIZE);
    path.lineTo(x, -RULER_SIZE + tickH);

    if (isMajor && rounded > 0) {
      hLabels.push({
        x: x + 2,
        y: -RULER_SIZE + FONT_SIZE + 1,
        text: cfg.toLabel(rounded),
      });
    }
  }

  // ── Vertical ruler (left edge, x ∈ [-RULER_SIZE, 0]) ───────────────────
  for (let y = 0; y <= canvasHeight; y += cfg.minor) {
    const rounded = Math.round(y);
    const isMajor =
      rounded % Math.round(cfg.interval) < SNAP ||
      rounded % Math.round(cfg.interval) > Math.round(cfg.interval) - SNAP;
    const isMid =
      !isMajor &&
      (rounded % Math.round(cfg.mid) < SNAP ||
        rounded % Math.round(cfg.mid) > Math.round(cfg.mid) - SNAP);

    const tickH = isMajor ? MAJOR_TICK : isMid ? MID_TICK : MINOR_TICK;
    // Ticks grow rightward from the left of the ruler bar.
    path.moveTo(-RULER_SIZE, y);
    path.lineTo(-RULER_SIZE + tickH, y);

    if (isMajor && rounded > 0) {
      // MW - Label sits just below the tick, left-aligned inside the bar.
      vLabels.push({
        x: -RULER_SIZE + 2,
        y: y + FONT_SIZE + 1,
        text: cfg.toLabel(rounded),
      });
    }
  }

  return { path, hLabels, vLabels };
}

/**
 * MW - RulerOverlay — renders pixel/cm rulers along the top and left edges of the
 * paper. Must be placed OUTSIDE <Group clip={paperRect}> so the ruler bars
 * extend into the grey canvas margin.
 *
 * Props:
 *   canvasWidth  {number}   paper width in px
 *   canvasHeight {number}   paper height in px
 *   visible      {boolean}  whether to render anything
 *   unit         {string}   'px' (default) | 'cm'
 */
export default function RulerOverlay({
  canvasWidth,
  canvasHeight,
  visible,
  unit = 'cm',
}) {
  const font = useMemo(() => {
    const tf = getSharedTypeface();
    return tf ? Skia.Font(tf, FONT_SIZE) : null;
  }, []);

  const {
    path: tickPath,
    hLabels,
    vLabels,
  } = useMemo(
    () => buildRuler(canvasWidth, canvasHeight, unit),
    [canvasWidth, canvasHeight, unit]
  );

  if (!visible) return null;

  return (
    <Group>
      {/* ── Ruler backgrounds ───────────────────────────────────────── */}
      {/* Corner square */}
      <Rect
        x={-RULER_SIZE}
        y={-RULER_SIZE}
        width={RULER_SIZE}
        height={RULER_SIZE}
        color="rgba(230,230,230,0.97)"
      />
      {/* Horizontal bar */}
      <Rect
        x={0}
        y={-RULER_SIZE}
        width={canvasWidth}
        height={RULER_SIZE}
        color="rgba(240,240,240,0.97)"
      />
      {/* Vertical bar */}
      <Rect
        x={-RULER_SIZE}
        y={0}
        width={RULER_SIZE}
        height={canvasHeight}
        color="rgba(240,240,240,0.97)"
      />

      {/* ── Inner border lines separating ruler from canvas ──────────── */}
      {/* Bottom edge of horizontal bar */}
      <Rect
        x={0}
        y={-1}
        width={canvasWidth}
        height={1}
        color="rgba(160,160,160,0.6)"
      />
      {/* Right edge of vertical bar */}
      <Rect
        x={-1}
        y={0}
        width={1}
        height={canvasHeight}
        color="rgba(160,160,160,0.6)"
      />

      {/* ── Tick marks ───────────────────────────────────────────────── */}
      <Path
        path={tickPath}
        color="rgba(80,80,80,0.75)"
        style="stroke"
        strokeWidth={0.5}
      />

      {/* ── Labels ───────────────────────────────────────────────────── */}
      {font &&
        hLabels.map((lbl, i) => (
          <Text
            key={`h${i}`}
            x={lbl.x}
            y={lbl.y}
            text={lbl.text}
            font={font}
            color="rgba(50,50,50,0.9)"
          />
        ))}
      {font &&
        vLabels.map((lbl, i) => (
          <Text
            key={`v${i}`}
            x={lbl.x}
            y={lbl.y}
            text={lbl.text}
            font={font}
            color="rgba(50,50,50,0.9)"
          />
        ))}
    </Group>
  );
}

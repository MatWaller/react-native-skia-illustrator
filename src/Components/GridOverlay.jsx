import React, { useMemo } from 'react';
import { Path, Skia } from '@shopify/react-native-skia';

// MW - Default grid cell size in canvas (paper-space) pixels.
const DEFAULT_GRID_SIZE = 50;

/**
 * GridOverlay — renders a uniform grid of lines across the paper area.
 * Must be placed inside a <Group clip={paperRect}> so lines are
 * automatically cropped to the canvas boundary.
 *
 * Props:
 *   canvasWidth  {number}  paper width in px
 *   canvasHeight {number}  paper height in px
 *   visible      {boolean} whether to render anything
 *   gridSize     {number}  cell size in paper-space px (default 50)
 */
export default function GridOverlay({
  canvasWidth,
  canvasHeight,
  visible,
  gridSize = DEFAULT_GRID_SIZE,
}) {
  const gridPath = useMemo(() => {
    const path = Skia.Path.Make();
    // Vertical lines
    for (let x = gridSize; x < canvasWidth; x += gridSize) {
      path.moveTo(x, 0);
      path.lineTo(x, canvasHeight);
    }
    // Horizontal lines
    for (let y = gridSize; y < canvasHeight; y += gridSize) {
      path.moveTo(0, y);
      path.lineTo(canvasWidth, y);
    }
    return path;
  }, [canvasWidth, canvasHeight, gridSize]);

  if (!visible) return null;

  return (
    <Path
      path={gridPath}
      color="rgba(100,149,237,0.2)"
      style="stroke"
      strokeWidth={0.5}
    />
  );
}

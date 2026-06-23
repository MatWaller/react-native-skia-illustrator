// Core imports
import React from 'react';

// Skia imports
import { Group, Rect, DashPathEffect } from '@shopify/react-native-skia';

// MW - Dashed selection rectangle rendered on the Skia canvas. All props are
// Reanimated derived values (SharedValue<T>) so updates run entirely on the
// UI thread without React re-renders.
const SelectionOutline = ({ origin, transform, x, y, width, height }) => (
  <Group origin={origin} transform={transform}>
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      color="rgba(0,122,255,0.5)"
      style="stroke"
      strokeWidth={2}
    >
      <DashPathEffect intervals={[8, 6]} />
    </Rect>
  </Group>
);

export default SelectionOutline;

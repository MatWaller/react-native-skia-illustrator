import React from 'react';
import { useDerivedValue } from 'react-native-reanimated';
import { Group, Rect, Circle } from '@shopify/react-native-skia';

export const ShapeNode = ({ shapeID, shapes }) => {
  const type = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.type : 'rect';
  });

  const x = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.x : 0;
  });

  const y = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.y : 0;
  });

  const width = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.width : 0;
  });

  const height = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.height : 0;
  });

  const radius = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.radius : 10;
  });

  const colour = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? shape.colour : 'black';
  });

  const origin = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape
      ? { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }
      : { x: 0, y: 0 };
  });

  const transform = useDerivedValue(() => {
    const shape = shapes.value.find((s) => s.id === shapeID);
    return shape ? [{ rotate: (shape.rotation * Math.PI) / 180 }] : [];
  });

  if (type.value === 'rect') {
    return (
      <Group origin={origin} transform={transform}>
        <Rect x={x} y={y} width={width} height={height} color={colour} />
      </Group>
    );
  }

  if (type.value === 'circle') {
    return (
      <Group origin={origin}>
        <Circle cx={x} cy={y} r={radius} color={colour} />
      </Group>
    );
  }
};

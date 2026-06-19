// Core Imports
import React, { useMemo, useEffect, useState } from 'react';

// React Native Imports
import { StyleSheet, View, Dimensions, Button } from 'react-native';

// Gesture Handler Imports
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

// Gesture Imports
import { createViewportGestures } from '../Gestures/viewportGestures';
import { createSelectionGestures } from '../Gestures/selectionGestures';
import { createPaintGestures } from '../Gestures/paintGestures';

// Reanimated Imports
import {
  useSharedValue,
  useDerivedValue,
  runOnJS,
} from 'react-native-reanimated';

// Skia Imports
import {
  Skia,
  Image,
  Canvas,
  Group,
  Path,
  Paint,
  Rect,
  Box,
  BoxShadow,
  rrect,
  rect,
  notifyChange,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
  BlendMode,
} from '@shopify/react-native-skia';

// MW - Wrapper Component for the canvas that handles gestures and renders shapes.
import { ShapeNode } from './ShapeNode';

// Container Dimensions
const { width, height } = Dimensions.get('window');

const PAPER_SIZE = { width: 200, height: 200 };
const PADDING = 150;

const SkiaIllustrator = React.forwardRef(
  (
    {
      canvasWidth = PAPER_SIZE.width,
      canvasHeight = PAPER_SIZE.height,
      imageSource = null,
    },
    ref
  ) => {
    2;
    // MW - Tool States
    const [currentTool, setCurrentTool] = React.useState('selection');
    const [currentColour, setCurrentColour] = React.useState('black');

    const [resolvedCanvas, setResolvedCanvas] = React.useState({
      width: canvasWidth,
      height: canvasHeight,
    });

    const initialX = (width - resolvedCanvas.width) / 2;
    const initialY = (height - resolvedCanvas.height) / 2;

    // MW - View port states.
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(initialX);
    const translateY = useSharedValue(initialY);
    const savedTranslateX = useSharedValue(initialX);
    const savedTranslateY = useSharedValue(initialY);

    // MW - Selection states.
    const selectedShapeId = useSharedValue(null);
    const selectedShapeStart = useSharedValue({ x: 0, y: 0 });

    // const shapes = useSharedValue([
    //   {
    //     id: '1',
    //     x: 50,
    //     y: 50,
    //     width: 100,
    //     height: 100,
    //     colour: 'red',
    //     rotation: 0,
    //     type: 'rect1',
    //   },
    //   {
    //     id: '2',
    //     x: 200,
    //     y: 200,
    //     width: 150,
    //     height: 150,
    //     colour: 'blue',
    //     rotation: 120,
    //     type: 'rect1',
    //   },
    //   {
    //     id: '3',
    //     x: 200,
    //     y: 400,
    //     width: 150,
    //     height: 150,
    //     colour: 'blue',
    //     radius: 10,
    //     type: 'circle',
    //   },
    // ]);

    // MW - Paint states.

    const shapes = useSharedValue([
        {
          id: '1',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          colour: 'black',
          rotation: 0,
          type: 'text',
          content: 'Hello World',
        },
    ]);
    const [allStrokesPath, setAllStrokesPath] = useState([]);

    // MW - Stroke Settings
    const activeStrokeThickness = useSharedValue(8);
    const activeStrokePath = useSharedValue(Skia.Path.Make());
    const activeStrokeColour = useSharedValue('black');

    // MW - Constants tied to min and max zoom :)
    const MIN_SCALE = 0.25;
    const MAX_SCALE = 5;

    // MW - Load the background image if provided.
    // If we are loading a background image the canvas size will be set to the size of the images - this overides the canvasWidth and canvasHeight props.
    const backgroundImage = useMemo(() => {
      if (!imageSource) {
        return null;
      }
      if (typeof imageSource === 'string') {
        try {
          const _pureb64 = imageSource.replace(/^data:image\/\w+;base64,/, '');
          const data = Skia.Data.fromBase64(_pureb64);
          return Skia.Image.MakeImageFromEncoded(data);
        } catch (error) {
          console.error('Error loading image from base64:', error);
          return null;
        }
      }
      return null;
    }, [imageSource]);

    // MW - rest timer
    const resetTimer = React.useRef(null);

    // MW - Function to add the current active stroke path to the list of all strokes and reset the active stroke path after a short delay.
    const addPathToAllStrokes = (
      path,
      colour,
      thickness = 8,
      isEraser = false
    ) => {
      setAllStrokesPath((prev) => [
        ...prev,
        { path, colour, isEraser, thickness },
      ]);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        activeStrokePath.value = Skia.Path.Make();
        notifyChange(activeStrokePath);
        resetTimer.current = null;
      }, 200);
    };

    // MW - Cancel a queued active-stroke reset. Called when a new stroke
    // starts so the previous stroke's delayed timer can't wipe the fresh
    // path mid-draw (which caused a stray line from the canvas origin).
    const cancelPendingReset = () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }
    };

    useEffect(() => {
      let targetWidth = canvasWidth;
      let targetHeight = canvasHeight;

      if (backgroundImage) {
        const imageWidth = backgroundImage.width();
        const imageHeight = backgroundImage.height();

        if (imageWidth && imageHeight) {
          targetWidth = imageWidth;
          targetHeight = imageHeight;
        }
      }

      setResolvedCanvas({ width: targetWidth, height: targetHeight });

      const newX = (width - targetWidth) / 2;
      const newY = (height - targetHeight) / 2;
      translateX.value = newX;
      translateY.value = newY;
      savedTranslateX.value = newX;
      savedTranslateY.value = newY;
    }, [backgroundImage, canvasWidth, canvasHeight, height, width]);

    const viewportMatrix = useDerivedValue(() => {
      const matrix = Skia.Matrix();

      const currentScale = scale.value || 1;
      const tx = translateX.value || 0;
      const ty = translateY.value || 0;

      matrix.translate(tx, ty);
      matrix.scale(currentScale, currentScale);
      return matrix;
    });

    const { panViewportGesture, pinchViewportGesture } = createViewportGestures(
      {
        currentTool,
        scale,
        savedScale,
        translateX,
        translateY,
        savedTranslateX,
        savedTranslateY,
        windowHeight: height,
        windowWidth: width,
        canvasWidth: resolvedCanvas.width,
        canvasHeight: resolvedCanvas.height,
      }
    );

    const { panSelectionGesture, rotateSelectionGesture } =
      createSelectionGestures({
        currentTool,
        scale,
        translateX,
        translateY,
        selectedShapeId,
        selectedShapeStart,
        shapes,
      });

    const { paintGesture } = createPaintGestures({
      currentTool,
      scale,
      translateX,
      translateY,
      activeStrokePath,
      activeStrokeColour,
      activeStrokeThickness,
      addPathToAllStrokes,
      cancelPendingReset,
    });

    // MW - Combined Move Tool Gestures (Pan + Pinch)
    const moveGestures = Gesture.Simultaneous(
      panViewportGesture,
      pinchViewportGesture
    );

    // MW - Active Gestures based on current tool.
    const activeGestures = useMemo(() => {
      switch (currentTool) {
        case 'move':
          return moveGestures;
        case 'selection':
          return Gesture.Simultaneous(
            panSelectionGesture,
            rotateSelectionGesture
          );
        case 'paint':
        case 'eraser':
          return paintGesture;
        case 'shape':
          // MW - For now, we don't have any gestures for the shape tool, so we return an empty gesture.
          return Gesture.Exclusive();
        default:
          return Gesture.Exclusive();
      }
    }, [
      currentTool,
      moveGestures,
      panSelectionGesture,
      rotateSelectionGesture,
      paintGesture,
    ]);

    const paperRect = rect(0, 0, resolvedCanvas.width, resolvedCanvas.height);
    const paperRRect = rrect(paperRect, 4, 4);

    const renderedShapes = useDerivedValue(() => {
      return shapes.value;
    });

    // MW - Clear Canvas Function
    const clearCanvas = () => {
      'worklet';
      shapes.value = [];
      runOnJS(setAllStrokesPath)([]);
    };

    const setColour = (colour) => {
      'worklet';
      setCurrentColour(colour);
      runOnJS(() => {
        activeStrokeColour.value = colour;
      })();
    };

    const setBrushSize = (size) => {
      'worklet';
      activeStrokeThickness.value = size;
    };

    const saveCanvasAsImage = async () => {
      const surface = Skia.Surface.MakeOffscreen(
        resolvedCanvas.width,
        resolvedCanvas.height
      );

      if (!surface) {
        throw new Error('Failed to create offscreen surface for saving.');
      }

      const canvas = surface.getCanvas();

      // Draw the background image if it exists
      if (backgroundImage) {
        canvas.drawImageRect(
          backgroundImage,
          rect(0, 0, backgroundImage.width(), backgroundImage.height()),
          rect(0, 0, resolvedCanvas.width, resolvedCanvas.height),
          Skia.Paint()
        );
      }

      // Draw all shapes (matches the on-screen ShapeNode rendering)
      shapes.value.forEach((shape) => {
        const { x, y, width: w, height: h, colour, rotation, type } = shape;
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(colour));
        paint.setStyle(PaintStyle.Fill);

        if (type === 'circle') {
          // Circles are not rotated on screen.
          canvas.drawCircle(x, y, shape.radius ?? 10, paint);
          return;
        }

        // Rectangles rotate around their centre.
        canvas.save();
        canvas.rotate(rotation ?? 0, x + w / 2, y + h / 2);
        canvas.drawRect(rect(x, y, w, h), paint);
        canvas.restore();
      });

      // Draw all committed strokes
      allStrokesPath.forEach((stroke) => {
        const { path, colour, thickness, isEraser } = stroke;
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(colour ?? 'black'));
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(thickness ?? 8);
        paint.setStrokeCap(StrokeCap.Round);
        paint.setStrokeJoin(StrokeJoin.Round);

        if (isEraser) {
          paint.setBlendMode(BlendMode.Clear);
        }

        canvas.drawPath(path, paint);
      });

      surface.flush();

      const imageSnapshot = surface.makeImageSnapshot();
      const base64 = imageSnapshot.encodeToBase64();

      return `data:image/png;base64,${base64}`;
    };

    React.useImperativeHandle(
      ref,
      () => ({
        clearCanvas,
        setCurrentTool,
        getCurrentTool: () => currentTool,
        setColour,
        getCurrentColour: () => currentColour,
        setBrushSize,
        getCurrentBrushSize: () => activeStrokeThickness.value,
        saveCanvasAsImage,
      }),
      [
        currentTool,
        currentColour,
        allStrokesPath,
        resolvedCanvas,
        backgroundImage,
      ]
    );

    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <GestureDetector gesture={activeGestures}>
          <View style={styles.container}>
            <Canvas style={{ width, height }}>
              <Group matrix={viewportMatrix}>
                {
                  // MW - Below is the paperRect with a white background and a shadow.
                }
                <Box box={paperRect} color="white">
                  <BoxShadow dx={0} dy={2} blur={4} color="rgba(0,0,0,0.65)" />
                  <BoxShadow
                    dx={0}
                    dy={12}
                    blur={24}
                    color="rgba(0,0,0,0.08)"
                  />
                </Box>
                {
                  // MW - Below is the drawing area of the canvas - anything inside of the Group with the clip will be clipped to the paperRect.
                }
                <Group clip={paperRect}>
                  {backgroundImage && (
                    <Image
                      image={backgroundImage}
                      x={0}
                      y={0}
                      width={resolvedCanvas.width}
                      height={resolvedCanvas.height}
                      fit="fill"
                    />
                  )}
                  <Group layer={<Paint />}>
                    {renderedShapes.value.map((shape) => (
                      <ShapeNode
                        key={shape.id}
                        shapeID={shape.id}
                        shapes={shapes}
                      />
                    ))}
                    {allStrokesPath.map((stroke, index) => (
                      <Path
                        key={index}
                        path={stroke.path}
                        color={stroke.colour}
                        style="stroke"
                        strokeWidth={stroke.thickness || 8}
                        strokeCap="round"
                        strokeJoin="round"
                        blendMode={stroke.isEraser ? 'clear' : 'srcOver'}
                      />
                    ))}
                    {activeStrokePath.value != null && (
                      <Path
                        path={activeStrokePath}
                        color={currentColour}
                        style="stroke"
                        strokeWidth={activeStrokeThickness.value}
                        strokeCap="round"
                        strokeJoin="round"
                        blendMode={
                          currentTool === 'eraser' ? 'clear' : 'srcOver'
                        }
                      />
                    )}
                  </Group>
                </Group>
              </Group>
            </Canvas>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    );
  }
);

export default SkiaIllustrator;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dfdfdf',
  },
});

// MW - Web canvas illustrator. Renders shapes/strokes to a 2D canvas and
// wires up history, pointer, keyboard and imperative-API hooks.

import React from 'react';
import { PAPER_SIZE } from '../utils/shapeUtils';
import { TextEditor } from './Components/TextEditor';
import { DEFAULT_LAYERS, cloneLayer, makeId } from './constants';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { useCanvasRenderer } from './hooks/useCanvasRenderer';
import { useCanvasSerialization } from './hooks/useCanvasSerialization';
import { useImperativeApi } from './hooks/useImperativeApi';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePointerInteractions } from './hooks/usePointerInteractions';
import { useTextEditor } from './hooks/useTextEditor';
import { useViewportSetup } from './hooks/useViewportSetup';
import { webStyles } from './styles';
import { normalizeShape } from './utils/geometry';

const SkiaIllustratorWeb = React.forwardRef(
  (
    {
      canvasWidth = PAPER_SIZE.width,
      canvasHeight = PAPER_SIZE.height,
      imageSource = null,
      initialData = null,
      onToolChange = null,
      onSelectedShapeChange = null,
      onSave = null,
      textModalProps = null,
      style = null,
      className = undefined,
      active = true,
      enableEraseShape = false,
      defaultSettings = {
        tool: 'pen',
        brushSize: 8,
        lineThickness: 4,
        fontSize: 32,
        brushColour: 'black',
        highlighterColour: 'yellow',
        shape: 'line',
        iconName: 'location-dot',
        showRuler: false,
        showGrid: false,
        viewPortSize: { width: 800, height: 800 },
      },
    },
    ref
  ) => {
    const hostRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const imageRef = React.useRef(null);
    const pointerRef = React.useRef(null);
    const stateRef = React.useRef(null);
    // MW - Last known canvas-space pointer position, used to draw the brush
    // size indicator for paint/highlighter without triggering a re-render.
    const hoverPointRef = React.useRef(null);

    const [viewportSize, setViewportSize] = React.useState({
      width: defaultSettings.viewPortSize?.width ?? 800,
      height: defaultSettings.viewPortSize?.height ?? 800,
    });
    const [resolvedCanvas, setResolvedCanvas] = React.useState({
      width: canvasWidth,
      height: canvasHeight,
    });
    const [currentTool, setCurrentToolState] = React.useState(
      defaultSettings.tool
    );
    const [currentColour, setCurrentColour] = React.useState(
      defaultSettings.brushColour
    );
    const [currentHighlighterColour, setCurrentHighlighterColour] =
      React.useState(defaultSettings.highlighterColour);
    const [brushSize, setBrushSizeState] = React.useState(
      defaultSettings.brushSize
    );
    // MW - A line's stroke thickness is its own control, decoupled from the
    // paint brush size (a line isn't a freehand stroke).
    const [lineThickness, setLineThicknessState] = React.useState(
      defaultSettings.lineThickness ?? 4
    );
    const [fontSize, setFontSizeState] = React.useState(
      defaultSettings.fontSize
    );
    const [shapeToolType, setShapeToolType] = React.useState(
      defaultSettings.shape ?? null
    );
    const [activeIconData, setActiveIconData] = React.useState(null);
    const [defaultText, setDefaultText] = React.useState('');
    const [transform, setTransform] = React.useState({ scale: 1, x: 0, y: 0 });
    const [shapes, setShapes] = React.useState([]);
    const [strokes, setStrokes] = React.useState([]);
    const [layers, setLayers] = React.useState(DEFAULT_LAYERS.map(cloneLayer));
    const [activeLayerId, setActiveLayerId] = React.useState('shapes');
    const [selectedShapeId, setSelectedShapeId] = React.useState(null);
    const [showGrid, setShowGrid] = React.useState(
      defaultSettings.showGrid ?? false
    );
    const [showRuler, setShowRuler] = React.useState(
      defaultSettings.showRuler ?? false
    );
    const [rulerUnit, setRulerUnit] = React.useState('px');
    const [canvasReady, setCanvasReady] = React.useState(false);

    const snapshotState = () => ({
      currentTool,
      currentColour,
      currentHighlighterColour,
      brushSize,
      lineThickness,
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
      enableEraseShape,
    });
    stateRef.current = snapshotState();

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
      stateRef.current = snapshotState();
    });

    useViewportSetup({
      hostRef,
      canvasRef,
      stateRef,
      viewportSize,
      setViewportSize,
      setCanvasReady,
      resolvedCanvas,
      setResolvedCanvas,
      setTransform,
      canvasWidth,
      canvasHeight,
      imageSource,
      imageRef,
    });

    const { pushHistory, undo, redo, historySize, undoRef, redoRef } =
      useCanvasHistory({
        stateRef,
        setShapes,
        setStrokes,
        setLayers,
        setSelectedShapeId,
      });

    const { editor, setEditor, addTextAt, editTextShape, submitEditor } =
      useTextEditor({
        stateRef,
        setShapes,
        setSelectedShapeId,
        setCurrentTool,
        pushHistory,
        defaultText,
      });

    // MW - Reset transient interaction state when this instance becomes
    // inactive (e.g. a tabbed host switching to a different illustrator).
    React.useEffect(() => {
      if (active) return;
      pointerRef.current = null;
      setEditor((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    }, [active, setEditor]);

    // MW - Places a new shape at the drag start/end points, or a default
    // size if it was just a click.
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
            ...(type === 'line' ? { thickness: current.lineThickness } : null),
          };
        }
        pushHistory();
        setShapes([...current.shapes, normalizeShape(shape)]);
        setSelectedShapeId(id);
        setCurrentTool('control');
      },
      [pushHistory, setCurrentTool]
    );

    const renderCanvas = useCanvasRenderer({
      canvasRef,
      imageRef,
      pointerRef,
      hoverPointRef,
      stateRef,
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
    });

    const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } =
      usePointerInteractions({
        active,
        canvasRef,
        pointerRef,
        hoverPointRef,
        stateRef,
        renderCanvas,
        pushHistory,
        setShapes,
        setStrokes,
        setSelectedShapeId,
        setTransform,
        addTextAt,
        editTextShape,
        addShapeAt,
      });

    const { serializeCanvas, loadCanvas, saveCanvasAsImage } =
      useCanvasSerialization({
        stateRef,
        imageRef,
        pushHistory,
        setLayers,
        setShapes,
        setStrokes,
        setSelectedShapeId,
      });

    React.useLayoutEffect(() => {
      if (initialData) loadCanvas(initialData);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { onKeyDown } = useKeyboardShortcuts({
      editorVisible: editor.visible,
      stateRef,
      pushHistory,
      setShapes,
      setStrokes,
      setSelectedShapeId,
      setCurrentTool,
      setShowGrid,
      setShowRuler,
      undo,
      redo,
      onSave,
    });

    useImperativeApi({
      ref,
      stateRef,
      pushHistory,
      undo,
      redo,
      undoRef,
      redoRef,
      setShapes,
      setStrokes,
      setLayers,
      setActiveLayerId,
      setSelectedShapeId,
      setCurrentTool,
      setCurrentColour,
      setCurrentHighlighterColour,
      setBrushSizeState,
      setLineThicknessState,
      setFontSizeState,
      setShapeToolType,
      setActiveIconData,
      setDefaultText,
      setEditor,
      setShowGrid,
      setShowRuler,
      setRulerUnit,
      saveCanvasAsImage,
      serializeCanvas,
      loadCanvas,
    });

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
          onPointerLeave={onPointerLeave}
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
          autoFocus={true}
        />
        <span style={webStyles.historyStatus} aria-hidden="true">
          {historySize.undo}:{historySize.redo}
        </span>
      </div>
    );
  }
);

SkiaIllustratorWeb.displayName = 'SkiaIllustratorWeb';

export default SkiaIllustratorWeb;

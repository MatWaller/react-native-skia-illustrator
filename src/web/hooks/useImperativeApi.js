// MW - The imperative ref API: toolbar-driven actions (tool/colour/size,
// layers, reordering, undo/redo, import/export) exposed to the host app.

import React from 'react';
import { getShapeLayer } from '../../utils/shapeUtils';
import {
  PAINT_LIKE_TOOLS,
  COLOURABLE_TYPES,
  clamp,
  makeId,
} from '../constants';
import {
  buildGroupedPathShape,
  getShapeBounds,
  shapeToStroke,
} from '../utils/geometry';
import { measureWebText } from '../utils/text';

export const useImperativeApi = ({
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
}) => {
  // MW - Moves a shape within its own layer's stacking order, or flattens
  // it into the underlayer's strokes when sent to the very back of it.
  const reorderShape = React.useCallback(
    (shapeId, direction, flattenAtBack = false) => {
      if (!shapeId) return;
      const current = stateRef.current;
      const idx = current.shapes.findIndex((shape) => shape.id === shapeId);
      if (idx === -1) return;
      const layer = getShapeLayer(current.shapes[idx]);
      const indices = current.shapes
        .map((shape, i) => (getShapeLayer(shape) === layer ? i : -1))
        .filter((i) => i !== -1);
      const pos = indices.indexOf(idx);
      let targetPos =
        direction === Infinity
          ? indices.length - 1
          : direction === -Infinity
            ? 0
            : pos + direction;
      targetPos = clamp(targetPos, 0, indices.length - 1);
      if (targetPos === pos) {
        if (flattenAtBack && pos === 0 && layer === 'underlayer') {
          const stroke = shapeToStroke(current.shapes[idx]);
          if (!stroke) return;
          pushHistory();
          setStrokes([...current.strokes, stroke]);
          setShapes(current.shapes.filter((shape) => shape.id !== shapeId));
          setSelectedShapeId(null);
        }
        return;
      }
      pushHistory();
      const next = [...current.shapes];
      const [shape] = next.splice(idx, 1);
      next.splice(indices[targetPos], 0, shape);
      setShapes(next);
    },
    [stateRef, pushHistory, setShapes, setStrokes, setSelectedShapeId]
  );

  React.useImperativeHandle(
    ref,
    () => ({
      clearCanvas: () => {
        pushHistory();
        setShapes([]);
        setStrokes([]);
        setSelectedShapeId(null);
      },
      setCurrentTool: (tool) => {
        const current = stateRef.current;
        const leavingPaintLikeTool =
          PAINT_LIKE_TOOLS.has(current.currentTool) &&
          current.currentTool !== tool;

        if (
          leavingPaintLikeTool &&
          current.strokes.length > 0 &&
          !PAINT_LIKE_TOOLS.has(tool)
        ) {
          // MW - Leaving a paint-like tool collapses the committed strokes
          // into a single selectable/movable shape (mirrors native).
          const pathShape = buildGroupedPathShape(
            current.strokes,
            current.activeLayerId
          );
          if (pathShape) {
            pushHistory();
            setShapes([...current.shapes, pathShape]);
            setStrokes([]);
            if (tool === 'control') setSelectedShapeId(pathShape.id);
          }
        }
        setCurrentTool(tool);
      },
      getCurrentTool: () => stateRef.current.currentTool,
      setColour: (colour) => {
        setCurrentColour(colour);
        const current = stateRef.current;
        if (current.selectedShapeId) {
          pushHistory();
          setShapes(
            current.shapes.map((shape) =>
              shape.id === current.selectedShapeId
                ? { ...shape, colour }
                : shape
            )
          );
        }
      },
      getCurrentColour: () => stateRef.current.currentColour,
      setHighlighterColour: (colour) => setCurrentHighlighterColour(colour),
      getCurrentHighlighterColour: () =>
        stateRef.current.currentHighlighterColour,
      setBrushSize: (size) => {
        setBrushSizeState(size);
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || selected.type === 'text') return;
        pushHistory();
        const newSize = size * 5;
        const updated =
          selected.type === 'circle'
            ? { ...selected, radius: newSize / 2 }
            : {
                ...selected,
                width: newSize,
                height:
                  newSize *
                  ((selected.height ?? newSize) / (selected.width || newSize)),
              };
        setShapes(
          current.shapes.map((shape) =>
            shape.id === selected.id ? updated : shape
          )
        );
      },
      getCurrentBrushSize: () => stateRef.current.brushSize,
      saveCanvasAsImage,
      serializeCanvas,
      loadCanvas,
      setFontSize: (size) => {
        setFontSizeState(size);
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || selected.type !== 'text') return;
        pushHistory();
        const measured = measureWebText(selected.content ?? '', size);
        setShapes(
          current.shapes.map((shape) =>
            shape.id === selected.id
              ? {
                  ...shape,
                  fontSize: size,
                  width: measured.width,
                  height: measured.height,
                }
              : shape
          )
        );
      },
      getCurrentFontSize: () => stateRef.current.fontSize,
      setText: (text) => {
        const value = text == null ? '' : String(text);
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (selected?.type === 'text') {
          pushHistory();
          const measured = measureWebText(
            value || ' ',
            selected.fontSize ?? current.fontSize
          );
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id
                ? {
                    ...shape,
                    content: value,
                    width: measured.width,
                    height: measured.height,
                  }
                : shape
            )
          );
        } else setDefaultText(value || 'New Text');
      },
      closeKeyboard: () => setEditor((prev) => ({ ...prev, visible: false })),
      deleteSelectedShape: () => {
        const current = stateRef.current;
        if (!current.selectedShapeId) return;
        pushHistory();
        setShapes(
          current.shapes.filter((shape) => shape.id !== current.selectedShapeId)
        );
        setSelectedShapeId(null);
      },
      hasSelectedShape: () => stateRef.current.selectedShapeId != null,
      getSelectedType: () => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        return selected?.type ?? null;
      },
      getSelectedPosition: () => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected) return null;
        const b = getShapeBounds(selected);
        return { x: b.x, y: b.y };
      },
      setSelectedPosition: ({ x, y } = {}) => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || x == null || y == null) return;
        const b = getShapeBounds(selected);
        const dx = x - b.x;
        const dy = y - b.y;
        pushHistory();
        setShapes(
          current.shapes.map((shape) =>
            shape.id === selected.id
              ? { ...shape, x: shape.x + dx, y: shape.y + dy }
              : shape
          )
        );
      },
      getSelectedSize: () => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected) return null;
        const b = getShapeBounds(selected);
        return { width: b.width, height: b.height };
      },
      setSelectedSize: ({ width, height } = {}) => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || width == null || height == null) return;
        const b = getShapeBounds(selected);
        const nw = Math.max(1, width);
        const nh = Math.max(1, height);
        pushHistory();
        let updated;
        if (selected.type === 'circle') {
          updated = {
            ...selected,
            x: b.x + nw / 2,
            y: b.y + nh / 2,
            radius: Math.min(nw, nh) / 2,
          };
        } else if (selected.type === 'text') {
          const measured = measureWebText(selected.content ?? '', nh);
          updated = {
            ...selected,
            x: b.x,
            y: b.y + measured.height,
            width: measured.width,
            height: measured.height,
            fontSize: nh,
          };
        } else {
          updated = { ...selected, x: b.x, y: b.y, width: nw, height: nh };
        }
        setShapes(
          current.shapes.map((shape) =>
            shape.id === selected.id ? updated : shape
          )
        );
      },
      getColourOfSelected: () => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || !COLOURABLE_TYPES.has(selected.type)) return null;
        return selected.colour ?? null;
      },
      setColourForSelected: (colour) => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || !COLOURABLE_TYPES.has(selected.type)) return;
        pushHistory();
        setShapes(
          current.shapes.map((shape) =>
            shape.id === selected.id ? { ...shape, colour } : shape
          )
        );
      },
      setTextForSelected: () => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected || selected.type !== 'text') return;
        setEditor({
          visible: true,
          mode: 'edit',
          value: selected.content ?? '',
          point: null,
          shapeId: selected.id,
        });
      },
      duplicateSelectedShape: () => {
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (!selected) return null;
        pushHistory();
        const duplicate = {
          ...selected,
          id: makeId(selected.type ?? 'shape'),
          x: selected.x + 20,
          y: selected.y + 20,
        };
        setShapes([...current.shapes, duplicate]);
        setSelectedShapeId(duplicate.id);
        return duplicate.id;
      },
      setShape: (type) => {
        setShapeToolType(type);
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (current.currentTool === 'shape' && selected) {
          pushHistory();
          const b = getShapeBounds(selected);
          const updated =
            type === 'circle'
              ? {
                  ...selected,
                  type,
                  x: b.x + b.width / 2,
                  y: b.y + b.height / 2,
                  radius: Math.min(b.width, b.height) / 2,
                  width: undefined,
                  height: undefined,
                }
              : {
                  ...selected,
                  type,
                  x: b.x,
                  y: b.y,
                  width: b.width,
                  height: b.height,
                  radius: undefined,
                  iconPath: undefined,
                  iconViewBox: undefined,
                  iconName: undefined,
                };
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id ? updated : shape
            )
          );
        }
      },
      getCurrentShape: () => stateRef.current.shapeToolType,
      setIcon: (iconData) => {
        setActiveIconData(iconData);
        setShapeToolType('icon');
        const current = stateRef.current;
        const selected = current.shapes.find(
          (shape) => shape.id === current.selectedShapeId
        );
        if (current.currentTool === 'shape' && selected) {
          pushHistory();
          const b = getShapeBounds(selected);
          const vb = iconData?.iconViewBox ?? { width: 512, height: 512 };
          const updated = {
            ...selected,
            type: 'icon',
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.width * (vb.height / vb.width),
            radius: undefined,
            iconName: iconData?.iconName ?? '',
            iconPath: iconData?.iconPath ?? '',
            iconViewBox: vb,
          };
          setShapes(
            current.shapes.map((shape) =>
              shape.id === selected.id ? updated : shape
            )
          );
        }
      },
      undo,
      redo,
      canUndo: () => undoRef.current.length > 0,
      canRedo: () => redoRef.current.length > 0,
      clearSelection: () => setSelectedShapeId(null),
      getLayers: () => stateRef.current.layers.map((layer) => ({ ...layer })),
      addLayer: (name) => {
        const id = makeId('layer');
        setLayers((prev) => {
          const textIdx = prev.findIndex((layer) => layer.id === 'text');
          const next = [...prev];
          next.splice(textIdx === -1 ? prev.length : textIdx, 0, {
            id,
            name: name || 'Layer',
          });
          return next;
        });
        setActiveLayerId(id);
        return id;
      },
      removeLayer: (layerId) => {
        if (['underlayer', 'drawing', 'shapes', 'text'].includes(layerId))
          return;
        setLayers((prev) => prev.filter((layer) => layer.id !== layerId));
        setShapes((prev) =>
          prev.map((shape) =>
            shape.layer === layerId ? { ...shape, layer: 'shapes' } : shape
          )
        );
        setActiveLayerId((prev) => (prev === layerId ? 'shapes' : prev));
      },
      setActiveLayer: (layerId) => setActiveLayerId(layerId),
      getActiveLayer: () => stateRef.current.activeLayerId,
      moveShapeToLayer: (layerId, id) => {
        const current = stateRef.current;
        const shapeId = id ?? current.selectedShapeId;
        if (!shapeId) return;
        pushHistory();
        setShapes(
          current.shapes.map((shape) =>
            shape.id === shapeId ? { ...shape, layer: layerId } : shape
          )
        );
      },
      moveLayerUp: (layerId) => {
        pushHistory();
        setLayers((prev) => {
          const i = prev.findIndex((layer) => layer.id === layerId);
          if (i < 0 || i >= prev.length - 1) return prev;
          const next = [...prev];
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
          return next;
        });
      },
      moveLayerDown: (layerId) => {
        pushHistory();
        setLayers((prev) => {
          const i = prev.findIndex((layer) => layer.id === layerId);
          if (i <= 0) return prev;
          const next = [...prev];
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
          return next;
        });
      },
      bringShapeForward: (id) =>
        reorderShape(id ?? stateRef.current.selectedShapeId, 1),
      sendShapeBackward: (id) =>
        reorderShape(id ?? stateRef.current.selectedShapeId, -1, true),
      bringShapeToFront: (id) =>
        reorderShape(id ?? stateRef.current.selectedShapeId, Infinity),
      sendShapeToBack: (id) =>
        reorderShape(id ?? stateRef.current.selectedShapeId, -Infinity),
      setGridVisible: (visible) => setShowGrid(visible),
      isGridVisible: () => stateRef.current.showGrid,
      toggleGrid: () => setShowGrid((visible) => !visible),
      setRulerVisible: (visible) => setShowRuler(visible),
      isRulerVisible: () => stateRef.current.showRuler,
      toggleRuler: () => setShowRuler((visible) => !visible),
      setRulerUnit: (unit) => setRulerUnit(unit),
      getRulerUnit: () => stateRef.current.rulerUnit,
    }),
    // MW - Everything else read here comes from stateRef or is a stable
    // setState setter, so it's safe to leave out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      loadCanvas,
      pushHistory,
      redo,
      saveCanvasAsImage,
      serializeCanvas,
      setCurrentTool,
      reorderShape,
      undo,
    ]
  );
};

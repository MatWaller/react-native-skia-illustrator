# react-native-skia-illustrator

A Skia-powered illustration component for React Native — draw, place shapes &
icons, add and edit text, manage layers, undo/redo, and export to an image. All
rendering and gestures run on the UI thread via Reanimated + Skia for a smooth,
60fps editing experience.

- ✏️ Freehand paint & eraser
- ▭ Resizable shapes (rect, circle, line, triangle, arrow, star, diamond, cross, check)
- ★ Vector icon placement (e.g. FontAwesome SVG paths) with aspect-ratio locking
- 🔤 Tap-to-add / double-tap-to-edit text via a fully themeable modal
- 🧱 Layers with z-ordering and flatten-to-drawing
- ↩️ Undo / redo
- 🖼️ Optional background image
- 💾 Serialize / restore project state, or export a PNG

---

## Installation

```sh
npm install react-native-skia-illustrator
# or
yarn add react-native-skia-illustrator
```

### Peer dependencies

This library builds on the following packages — install them in your app if you
haven't already:

```sh
yarn add @shopify/react-native-skia \
  react-native-gesture-handler \
  react-native-reanimated \
  react-native-worklets
```

| Package | Version |
| --- | --- |
| `@shopify/react-native-skia` | `>= 1.0.0` |
| `react-native-gesture-handler` | `>= 2.0.0` |
| `react-native-reanimated` | `>= 4.3.0` |
| `react-native-worklets` | `>= 0.8.0` |

Make sure you've completed each library's own setup (the Reanimated Babel
plugin in particular). `SkiaIllustrator` already renders its own
`GestureHandlerRootView` internally.

---

## Quick start

### React Native

```jsx
import React, { useRef } from 'react';
import { View } from 'react-native';
import { SkiaIllustrator } from 'react-native-skia-illustrator';

export default function App() {
  const ref = useRef(null);

  return (
    <View style={{ flex: 1 }}>
      <SkiaIllustrator
        ref={ref}
        onToolChange={(tool) => console.log('tool:', tool)}
        onSelectedShapeChange={(hasSelection) => console.log(hasSelection)}
      />
    </View>
  );
}
```

You drive the editor imperatively through the `ref`. For example, to switch to
the paint tool and set a colour:

```jsx
ref.current.setCurrentTool('paint');
ref.current.setColour('#6366f1');
```

### React for the browser

The package also includes a browser/desktop React implementation backed by
HTML canvas. It keeps the same imperative API, data model, tools, layers,
serialization, text editing, and PNG export, but does not require
`react-native`, Reanimated, Gesture Handler, or Skia in the web app.

```jsx
import React, { useRef } from 'react';
import { SkiaIllustrator } from 'react-native-skia-illustrator/web';

export default function WebApp() {
  const ref = useRef(null);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SkiaIllustrator
        ref={ref}
        onToolChange={(tool) => console.log('tool:', tool)}
        onSelectedShapeChange={(hasSelection) => console.log(hasSelection)}
      />
    </div>
  );
}
```

Browser interaction notes:

- Mouse drag in `control`, `move`, or `selection` moves selected shapes or pans
  empty canvas space.
- Holding the middle mouse button (mouse wheel) and dragging always pans the
  canvas, regardless of the active tool.
- Mouse wheel zooms around the cursor.
- Selection handles resize the active shape; the handle above the selection box
  rotates it.
- Double-click text to edit it. Press Delete/Backspace to remove the selected
  shape.
- A subtle brush-size outline follows the cursor while the paint, highlighter
  or eraser tool is active, so you can see exactly what area a stroke will
  cover before you click.
- Single-key shortcuts (disabled while typing in a text field) switch tools
  directly: <kbd>C</kbd> control, <kbd>P</kbd> paint, <kbd>H</kbd> highlighter,
  <kbd>T</kbd> text, <kbd>L</kbd> line, <kbd>I</kbd> shape, <kbd>E</kbd> eraser.
- Keyboard shortcuts (work on any tool, disabled while typing in a text
  field): <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>C</kbd> copies the selected
  shape, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>V</kbd> pastes it (offset from
  the original), <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd> undoes,
  <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>R</kbd> toggles the ruler,
  <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>G</kbd> toggles the grid,
  <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>N</kbd> clears the canvas, and
  <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> calls the `onSave` prop with
  the serialized canvas (see [Props](#props)).

---

## Tools

Set the active tool with `ref.current.setCurrentTool(tool)`:

| Tool | Behaviour |
| --- | --- |
| `control` / `move` | Drag empty canvas to pan, pinch to zoom (smooth focal-point zoom), drag a shape to move it, pinch/rotate a selected shape. |
| `selection` | Tap to select; drag to move; pinch to resize; rotate with two fingers. |
| `paint` | Freehand drawing with the active colour and brush size. |
| `paint-straight` | Same as `paint`, but the stroke is flattened to a straight line from the press point to release. |
| `eraser` | Erase paint strokes; dragging over a shape, icon or text deletes it. |
| `shape` | With a shape/icon selected: place by **tap** (default size) or **drag** (size in real time). With none selected, drag pans the canvas. |
| `text` | Tap to place text — a themeable modal opens to enter the content. |

### Placing shapes & icons

While the `shape` tool is active, choose what gets placed:

```jsx
ref.current.setShape('rect'); // 'rect' | 'circle' | 'line' | 'triangle'
                              // 'arrow' | 'star' | 'diamond' | 'cross' | 'check'
```

Then on the canvas:

- **Tap** to drop a shape at a default size, or
- **Drag** to anchor at the press point and size it in real time.

The **line** tool additionally supports **two-tap** placement: tap once to drop
the start point (a marker appears), tap again to set the end point. A drag also
works and overrides the pending tap. A line's stroke thickness has its own
control, `setLineThickness` (not the paint brush size); pinching a selected
line changes its length without affecting its thickness.

**Icons** are placed the same way (tap or drag) and always retain their original
aspect ratio so they're never distorted:

```jsx
ref.current.setIcon({
  iconName: 'star',
  iconPath: 'M259.3 17.8...', // SVG path data, e.g. from a FontAwesome icon
  iconViewBox: { width: 512, height: 512 },
});
```

> Tip: with `@fortawesome/free-solid-svg-icons`, an icon's `icon` array is
> `[width, height, ligatures, unicode, svgPathData]`, which maps directly onto
> `iconViewBox` and `iconPath`.

### Adding & editing text

With the `text` tool, tapping the canvas opens a modal to type the content; on
submit the text shape is placed at the tapped point. **Double-tapping** an
existing text shape re-opens the modal to edit it.

You can also preset the content for the next placed text, or replace the
selected text shape's content, with `setText`:

```jsx
ref.current.setText('Hello world');
```

---

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `canvasWidth` | `number` | `200` | Paper width in canvas units (ignored if `imageSource` is set). |
| `canvasHeight` | `number` | `200` | Paper height in canvas units (ignored if `imageSource` is set). |
| `imageSource` | `string \| null` | `null` | Base64 / data-URI background image. Sizes the canvas to the image. |
| `initialData` | `string \| object \| null` | `null` | Serialized project to restore on mount (see `serializeCanvas`). |
| `active` | `boolean` | `true` | Set to `false` to unmount the native Skia canvas subtree while keeping the component instance alive. Useful when hosting inside a React Native `Modal`; pass the modal's visible state so Skia detaches during modal close/teardown. |
| `pathToShape` | `boolean` | `false` | Commit paint strokes as selectable, movable, resizable custom path shapes. |
| `onToolChange` | `(tool: string) => void` | — | Fires when the active tool changes. |
| `onSelectedShapeChange` | `(hasSelection: boolean) => void` | — | Fires when the selection changes. |
| `onSave` | `(serializedCanvas: string) => void` | — | **Web only.** Fires when the user presses <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd>, with the same JSON string returned by `serializeCanvas()`. |
| `textModalProps` | `object \| null` | `null` | Style/label overrides for the text entry modal (see below). |

When rendering inside a host React Native `Modal`, wire `active` to the modal
visibility so the Skia surface is removed before the modal surface is destroyed:

```jsx
<Modal visible={editorVisible} animationType="slide">
  <SkiaIllustrator ref={ref} active={editorVisible} />
</Modal>
```

### Theming the text modal

The text editor is an absolutely-positioned overlay (not a native `Modal`, so it
nests safely inside a host modal). Pass `textModalProps` to fully theme it:

```jsx
<SkiaIllustrator
  ref={ref}
  textModalProps={{
    createTitle: 'Add text',
    editTitle: 'Edit text',
    placeholder: 'Type something…',
    submitLabel: 'Place',
    cancelLabel: 'Cancel',
    multiline: false,
    // Style overrides:
    cardStyle: { backgroundColor: '#14141c', borderRadius: 18 },
    titleStyle: { color: '#fff' },
    inputStyle: { color: '#fff', borderColor: 'rgba(255,255,255,0.18)' },
    submitButtonStyle: { backgroundColor: '#6366f1' },
    cancelButtonStyle: { backgroundColor: 'rgba(255,255,255,0.12)' },
    cancelButtonTextStyle: { color: 'rgba(255,255,255,0.9)' },
    placeholderTextColor: 'rgba(255,255,255,0.4)',
  }}
/>
```

Available `textModalProps`:

- **Labels:** `createHeader`, `editHeader`, `createTitle`, `editTitle`,
  `placeholder`, `cancelLabel`, `submitLabel`, `placeholderTextColor`
- **Behaviour:** `multiline`, `autoFocus`, `showHeader`
- **Styles:** `overlayStyle`, `backdropStyle`, `cardStyle`, `headerStyle`,
  `headerTextStyle`, `titleStyle`, `inputStyle`, `buttonRowStyle`,
  `cancelButtonStyle`, `cancelButtonTextStyle`, `submitButtonStyle`,
  `submitButtonTextStyle`

---

## Imperative API (`ref`)

### Tools & styling

| Method | Description |
| --- | --- |
| `setCurrentTool(tool)` / `getCurrentTool()` | Get/set the active tool. |
| `setColour(colour)` / `getCurrentColour()` | Set the paint colour (also recolours the selected shape). |
| `setBrushSize(size)` / `getCurrentBrushSize()` | Brush thickness (also resizes the selected shape, excluding lines/text). |
| `setLineThickness(thickness)` / `getCurrentLineThickness()` | Stroke thickness for new lines (also updates the selected line). |
| `setPathToShape(enabled)` / `getPathToShape()` | Commit paint strokes as custom path shapes instead of drawing-layer strokes. |
| `setFontSize(size)` / `getCurrentFontSize()` | Text size (also resizes selected text). |
| `setShape(type)` / `getCurrentShape()` | Choose the shape type to place. |
| `setIcon(iconData)` | Choose an icon (`{ iconName, iconPath, iconViewBox }`) to place. |
| `setText(text)` | Preset the next text's content, or replace the selected text's content. |

### Selection & editing

| Method | Description |
| --- | --- |
| `hasSelectedShape()` | Whether a shape is currently selected. |
| `clearSelection()` | Deselect. |
| `deleteSelectedShape()` | Delete the selected shape. |
| `closeKeyboard()` | Dismiss the text modal/keyboard. |
| `getSelectedType()` | Type of the selected shape (e.g. `'text'`, `'circle'`, `'icon'`), or `null` if nothing is selected. |
| `getSelectedPosition()` / `setSelectedPosition({ x, y })` | Get/set the selected shape's top-left position. |
| `getSelectedSize()` / `setSelectedSize({ width, height })` | Get/set the selected shape's size. |
| `getColourOfSelected()` / `setColourForSelected(colour)` | Get/set colour of the selected shape — only applies to `text`, `icon` and `line` shapes; no-ops otherwise. |
| `setTextForSelected()` | Opens the text edit modal for the selected text shape. |

### Layers & z-order

| Method | Description |
| --- | --- |
| `getLayers()` | List of `{ id, name }`. |
| `addLayer(name)` / `removeLayer(id)` | Add/remove a user layer. |
| `setActiveLayer(id)` / `getActiveLayer()` | Layer new shapes are placed on. |
| `moveShapeToLayer(layerId, shapeId?)` | Move a shape to a layer. |
| `moveLayerUp(id)` / `moveLayerDown(id)` | Reorder layers. |
| `bringShapeForward(id?)` / `sendShapeBackward(id?)` | Step a shape within its layer. |
| `bringShapeToFront(id?)` / `sendShapeToBack(id?)` | Move a shape to the front/back of its layer. |

### History

| Method | Description |
| --- | --- |
| `undo()` / `redo()` | Undo / redo the last change. |
| `canUndo()` / `canRedo()` | Whether undo/redo is available. |

### Canvas, grid & ruler

| Method | Description |
| --- | --- |
| `clearCanvas()` | Remove everything. |
| `setGridVisible(v)` / `isGridVisible()` / `toggleGrid()` | Grid visibility. |
| `setRulerVisible(v)` / `isRulerVisible()` / `toggleRuler()` | Ruler visibility. |
| `setRulerUnit(unit)` / `getRulerUnit()` | `'px'` or `'cm'`. |

### Persistence & export

| Method | Description |
| --- | --- |
| `serializeCanvas()` | Returns a JSON string of the full project (layers, shapes, strokes). |
| `loadCanvas(input)` | Restore from a JSON string or parsed object (undoable). |
| `saveCanvasAsImage()` | `Promise<string>` resolving to a `data:image/png;base64,...` URI. |

```jsx
// Save a project
const json = ref.current.serializeCanvas();
await AsyncStorage.setItem('project', json);

// Restore later
ref.current.loadCanvas(await AsyncStorage.getItem('project'));

// Export a PNG
const dataUri = await ref.current.saveCanvasAsImage();
```

---

## Example app

A full example with a toolbar, colour picker, shape/icon pickers and project
save/load lives in [`example/`](example). To run it:

```sh
yarn
yarn example android   # or: yarn example ios
```

---

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## Author

**Mathew Waller**

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)

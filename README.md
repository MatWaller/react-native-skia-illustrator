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
- Mouse wheel zooms around the cursor.
- Selection handles resize the active shape; the handle above the selection box
  rotates it.
- Double-click text to edit it. Press Delete/Backspace to remove the selected
  shape.

---

## Tools

Set the active tool with `ref.current.setCurrentTool(tool)`:

| Tool | Behaviour |
| --- | --- |
| `control` / `move` | Drag empty canvas to pan, pinch to zoom (smooth focal-point zoom), drag a shape to move it, pinch/rotate a selected shape. |
| `selection` | Tap to select; drag to move; pinch to resize; rotate with two fingers. |
| `paint` | Freehand drawing with the active colour and brush size. |
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
works and overrides the pending tap.

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
| `onToolChange` | `(tool: string) => void` | — | Fires when the active tool changes. |
| `onSelectedShapeChange` | `(hasSelection: boolean) => void` | — | Fires when the selection changes. |
| `textModalProps` | `object \| null` | `null` | Style/label overrides for the text entry modal (see below). |

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
| `setBrushSize(size)` / `getCurrentBrushSize()` | Brush thickness (also resizes the selected shape). |
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

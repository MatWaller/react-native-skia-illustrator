# SkiaIllustrator (Web)

A browser-based canvas illustrator: paint, shapes, text, icons, layers,
undo/redo and PNG export. Built on the HTML `<canvas>` 2D API, no
React Native or Skia dependency required. It mirrors the native
`react-native-skia-illustrator` component's behaviour and imperative API,
so the same host app code can drive either.

This folder is written to be self-contained enough to eventually split
into its own package (e.g. `@react-native-skia-illustrator/web`).

## Usage

```jsx
import { SkiaIllustratorWeb } from 'react-native-skia-illustrator/web';

const ref = React.useRef(null);

<SkiaIllustratorWeb
  ref={ref}
  canvasWidth={1000}
  canvasHeight={1400}
  defaultSettings={{ tool: 'pen', brushSize: 8, brushColour: 'black' }}
  onToolChange={(tool) => console.log(tool)}
  onSelectedShapeChange={(hasSelection) => console.log(hasSelection)}
/>;

// Later, drive it imperatively:
ref.current.setCurrentTool('paint');
ref.current.setColour('#ff0000');
const dataUrl = await ref.current.saveCanvasAsImage();
```

## Structure

```
web/
  index.jsx              Public exports
  SkiaIllustrator.jsx     Root component: composes state + hooks + JSX
  constants.js            Shared constants and clone/id helpers
  styles.js               Inline style objects
  Components/
    TextEditor.jsx        Modal used to create/edit text shapes
  hooks/
    useCanvasHistory.js        Undo/redo stack
    useViewportSetup.js        Resize, fit-to-view, image load, wheel zoom
    useCanvasRenderer.js       Draws the scene to the canvas each frame
    useTextEditor.js           Text modal open/submit/cancel flow
    usePointerInteractions.js  Pan/draw/create-shape/move/resize/rotate
    useKeyboardShortcuts.js    Hotkeys (tools, undo/redo, copy/paste, etc.)
    useCanvasSerialization.js  Serialize/load/export the canvas
    useImperativeApi.js        The `ref` API exposed to the host app
  utils/
    geometry.js           Shape bounds, hit testing, path building (pure)
    drawing.js             Canvas 2D draw functions (shapes, strokes, grid, ruler, selection)
    text.js                 Text measuring and highlighter colour helpers
```

## Design notes

- All mutable interaction state (shapes, strokes, tool, etc.) lives in
  React state, mirrored into a `stateRef` so callbacks (pointer handlers,
  the imperative API) always read the latest values without re-creating
  themselves on every change.
- Rendering is a single `renderCanvas` pass over `<canvas>` — there's no
  virtual scene graph, so it stays close to plain Canvas 2D code.
- The imperative `ref` API (`setCurrentTool`, `setColour`, `undo`, layer
  management, etc.) is kept API-compatible with the native component so
  toolbar code can be shared between platforms.

## Comments

Code comments prefixed `MW -` explain *why* something is done a
particular way, not what the code does — keep new ones short (1–2 lines).

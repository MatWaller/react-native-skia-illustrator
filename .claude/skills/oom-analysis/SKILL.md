---
name: oom-analysis
description: "Analyse the src/ directory for Out-of-Memory (OOM) concerns in React Native. Use when asked to find memory leaks, OOM issues, memory pressure, unbounded growth, or high memory usage in the React Native source code. Returns a description of each concern and actionable steps to resolve it."
---

# OOM Analysis — React Native (`src/` only)
Use this skill when asked to find OOM concerns, memory leaks, or high memory usage in the project.

## Scope

**Only inspect files under `src/`.**  
Do not read `example/`, `lib/`, `node_modules/`, or any other directory.

---

## Step 1 — Enumerate files

List every `.js`, `.jsx`, `.ts`, and `.tsx` file under `src/` recursively. Read them all before drawing any conclusions.

---

## Step 2 — Scan and Report Incrementally

Work through the Pattern Catalogue **one category at a time** (A–W). For each category:

1. Search all files in `src/` for that pattern.
2. If a finding exists, **immediately output the finding block** (see Step 3 template) before moving to the next category.
3. After outputting a finding, pause briefly so the user can read it, then continue with the next category.
4. If a category has no findings, print a single line: `[X] No findings.` and continue.

Do **not** collect all findings first and dump a report at the end. Each category is processed and surfaced as it is checked.

### Pattern Catalogue

#### A. Unbounded collection growth
- Arrays in `useState`, `useRef`, `useSharedValue`, or module-level scope that are only ever appended to (push / concat / spread) with no eviction, cap, or clear.
- Example: `allStrokes.push(path)` with no maximum length guard.
- **Why it causes OOM**: Each committed item is retained for the lifetime of the component (or app session). After hundreds of operations the heap grows until the OS kills the process.

#### B. Native / C++ object handles not released
- Any object backed by native heap memory (e.g. graphics objects, audio buffers, SQLite cursors, camera frames, file handles) created inside render functions or loops without a corresponding `.dispose()`, `.release()`, `.close()`, or `.delete()` call.
- A `useRef` or `useSharedValue` holding a native-backed object that is replaced without releasing the previous instance.
- **Why it causes OOM**: Native-backed objects are not tracked by the JS garbage collector. The JS reference can be dropped while the native allocation lives on, silently growing the native heap until the OS kills the process.

#### C. Large objects captured in closures / cross-thread transfers
- Arrow functions that close over large arrays, native-backed objects, or entire component prop objects.
- `runOnJS` / `runOnWorklet` (Reanimated), `postMessage`, or any cross-thread API that serialises large payloads on every event or frame.
- **Why it causes OOM**: Each thread-local copy of a large closure or serialised payload lives independently of the originating GC context. Under high event rates (gestures, animations) multiple in-flight copies accumulate simultaneously.

#### D. Missing `useEffect` cleanup
- `addEventListener`, `setInterval`, `setTimeout`, Reanimated `addListener`, or any subscription created inside `useEffect` without a returned cleanup function.
- **Why it causes OOM**: Retained listeners keep their entire closure (and the component subtree) alive after the component unmounts, causing a classic ref-counting leak.

#### E. Inline object / array literals in render
- `style={{ ... }}`, `matrix={[...]}`, or any prop receiving a new object/array literal on every render inside a component that renders frequently (gesture callbacks, animation frames).
- **Why it causes OOM**: High-frequency allocation floods the young-generation heap, increasing GC pressure and causing jank that can cascade into OOM on low-RAM devices.

#### F. Images / large assets required inside render or hooks
- `require('../assets/image.png')` or `fetch(url)` called inside a component body or derived/animated value callback.
- **Why it causes OOM**: The asset is decoded into an uncompressed bitmap on every render. A single high-resolution image can be tens of MB, and without a stable reference it is re-decoded on each pass rather than reused from cache.

#### G. Undo/redo stacks without a depth cap
- History arrays (`past`, `history`, `undoStack`, etc.) that grow without a maximum depth.
- **Why it causes OOM**: Every undo entry holds a full snapshot of application state. Without a cap, long sessions exhaust memory.

#### H. Cross-thread shared state storing deep objects
- Reanimated `useSharedValue`, Zustand stores used from worklets, or any cross-thread shared state holding arrays of plain objects where each element contains large string blobs or nested arrays.
- Mutations that spread/clone the whole array on every change (e.g. `items.value = [...items.value, newItem]`) at high frequency.
- **Why it causes OOM**: Cross-thread state management serialises the full value on every assignment. Frequent full-array replacement causes O(n) serialisation cost per update and can create multiple in-flight copies simultaneously.

#### I. Timers / deferred work not cancelled on unmount
- `setTimeout`, `setInterval`, or `requestAnimationFrame` stored in a `useRef` but the ref is never cleared in a `useEffect` cleanup or component teardown.
- **Why it causes OOM**: Pending timers keep their closure alive, which keeps the component and all captured values alive past unmount.

#### J. Unconstrained buffer / surface / texture allocations
- Width, height, or byte-length of any GPU surface, off-screen buffer, or texture driven by unclamped user input or device dimensions without a maximum.
- Buffer sizes computed as a multiple of a user-supplied value with no upper bound check.
- **Why it causes OOM**: GPU surfaces and off-screen buffers consume memory proportional to their dimensions. On a mid-range device even a single oversized allocation can exhaust available GPU or native heap memory.

#### K. FlatList / ScrollView rendering unbounded item counts
- `ScrollView` used instead of `FlatList`/`FlashList` for lists that can grow beyond ~20 items.
- `FlatList` present but missing `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize`, or `initialNumToRender` tuning.
- `FlatList` without `getItemLayout` forcing measurement of every off-screen cell.
- **Why it causes OOM**: `ScrollView` renders every child eagerly and keeps all of them mounted. On large lists this exhausts the JS heap and inflates the shadow tree held by the native side.

#### L. Images loaded at full resolution without downsizing
- `<Image>` / `<FastImage>` displaying assets larger than their rendered size with no `resizeMethod="resize"` or explicit `width`/`height` constraints.
- `require()` referencing `@1x` assets that ship at 3–4× physical pixel density.
- Base64-encoded images inlined directly in JSX or state.
- **Why it causes OOM**: React Native decodes images into uncompressed bitmaps in memory. A 3000×4000 image costs ~46 MB regardless of its display size. Multiple such images simultaneously live in the native image cache.

#### M. Global / Context state holding large server payloads
- `useContext`, Redux store, Zustand, or Jotai atoms storing complete API responses, large arrays, or binary blobs without normalisation or pagination.
- State that accumulates new pages of data without evicting old ones (infinite-scroll pattern with no virtualisation of the data layer).
- **Why it causes OOM**: The entire state tree is serialised to the native shadow thread on every dispatch. Large payloads cause quadratic memory growth as pages accumulate.

#### N. NativeEventEmitter / DeviceEventEmitter subscriptions not removed
- `NativeEventEmitter`, `DeviceEventEmitter`, or `Linking` listeners added inside a component or hook without removal in a cleanup function.
- Multiple mounts of the same component (e.g., tab screens) each adding a listener without deduplication.
- **Why it causes OOM**: Each subscription holds a reference to its handler closure, preventing the component instance and its entire captured scope from being GC'd after unmount.

#### O. Navigation screens retained in memory without `unmountOnBlur`
- React Navigation stack/tab/drawer navigators that keep every visited screen mounted (default behaviour) when the screens hold large state, active animations, or open connections.
- Screens that start polling, websocket connections, or video streams in `useEffect` without stopping them when the screen loses focus.
- **Why it causes OOM**: Every screen in the navigation history remains fully mounted. On a deep navigation stack each screen's component tree, shared values, and subscriptions remain live simultaneously.

#### P. Bridge / JSI payload transfers of large binary data
- `JSON.stringify` of large objects passed to native modules, or `ArrayBuffer` / `Uint8Array` blobs serialised across the React Native bridge on every frame.
- `fetch` responses stored as raw strings in state rather than parsed and normalised.
- **Why it causes OOM**: Bridge serialisation creates a temporary copy of the data on both sides of the boundary. A 10 MB payload temporarily occupies 20+ MB until the copy is released. At animation frame rates this creates sustained memory pressure.

#### Q. Hermes heap ceiling hit by accumulated module cache
- Dynamic `require()` or `import()` calls inside loops or gesture handlers that accumulate entries in the module registry.
- Large JSON files (translations, config, fixture data) `require()`d at the top of frequently-used modules, keeping them in the module cache for the app lifetime.
- **Why it causes OOM**: The Hermes JS engine on Android defaults to a 512 MB heap cap. Large or frequently-growing module caches erode this headroom and cause an OOM kill before the GC can reclaim space.

#### R. Firebase Firestore / Realtime Database listeners not unsubscribed
- `onSnapshot()`, `collection().onSnapshot()`, or Realtime Database `on()` calls inside a component or hook without calling the returned unsubscribe function (or `ref.off()`) in a `useEffect` cleanup.
- Multiple mounts of the same screen each registering a listener to the same document or query without deduplication.
- **Why it causes OOM**: Each active listener opens a persistent WebSocket channel and buffers incoming document payloads in memory. Leaked listeners accumulate over navigation, eventually exhausting both JS heap and native socket buffers.

#### S. Firestore queries returning unbounded result sets
- `getDocs(collection(db, 'items'))` or `onSnapshot(collection(db, 'items'))` with no `.limit()` applied.
- Paginated queries that store every fetched page in state without evicting earlier pages.
- **Why it causes OOM**: A collection with thousands of documents is deserialised into plain JS objects in full. On low-RAM devices a single unbounded query can exceed available heap. Accumulating pages without eviction compounds this over a session.

#### T. Firebase Storage loading large files into memory with `getBytes()`
- `getBytes(ref, maxSize)` called with an extremely large or unbounded `maxSize`, or called repeatedly for large media files (video, high-res images) without streaming.
- Downloaded bytes stored directly in React state or a module-level variable rather than written to the device filesystem.
- **Why it causes OOM**: `getBytes()` allocates the entire file as a single `Uint8Array` in the JS heap. A 50 MB video file occupies 50 MB of heap immediately. Storing multiple such blobs simultaneously or re-downloading on re-render multiplies this pressure.

#### U. RNFS (react-native-fs) — large file reads loaded into JS memory
- `RNFS.readFile(path)` or `RNFS.readFile(path, 'base64')` called on files that can be large (videos, exports, logs, images) without a size check beforehand.
- The result stored directly in `useState`, a `useRef`, or a module-level variable rather than passed immediately to a consumer and released.
- `RNFS.readFile` called inside a loop or on every render/effect without memoisation, causing the same large file to be loaded multiple times concurrently.
- **Why it causes OOM**: `readFile` deserialises the entire file into a JS string or base64 string in one allocation. A 20 MB file becomes a ~27 MB base64 string. Holding multiple such strings simultaneously — or re-reading on each render — exhausts the Hermes heap rapidly.

#### V. RNFS — `readDir()` result sets not paginated
- `RNFS.readDir(path)` called on directories that can contain thousands of entries (photo library paths, cache directories, document exports) with no pagination or result cap.
- The full `ReadDirItem[]` array stored in state and rendered directly into a `ScrollView` rather than a virtualised list.
- **Why it causes OOM**: Each `ReadDirItem` is a plain JS object with multiple string fields. A directory with 10 000 files produces 10 000 objects allocated simultaneously. Combined with an un-virtualised `ScrollView`, every item also creates a native view node.

#### W. RNFS — temporary and cache files never deleted
- Files written to `RNFS.TemporaryDirectoryPath` or `RNFS.CachesDirectoryPath` (e.g. downloaded media, export buffers, thumbnails) inside a component or hook with no cleanup in a `useEffect` return, `AppState` change handler, or explicit purge step.
- `RNFS.downloadFile()` tasks that are not cancelled (`jobId` stored but `RNFS.stopDownload(jobId)` never called on unmount).
- **Why it causes OOM**: Accumulated temp files consume storage. When free storage falls below the OS threshold the system kills background processes and may OOM-kill the app to reclaim memory used by its file buffers. Leaked `downloadFile` jobs also hold in-memory write buffers open past their intended lifetime.

---

## Step 3 — Finding Template

Use this template each time a finding is surfaced (immediately after checking its category — do not batch):

```
---
## [Category Letter]. [Category Name]

### Finding [Severity]: <one-line summary>
**File**: `src/path/to/file.jsx` (line N)

**Description**
<Explain what the code is doing and why it is an OOM risk in concrete terms. Reference the actual variable/function names found in the file.>

**Actionable Steps**
1. <Specific change to make — name the variable, function, or line.>
2. <Second step if needed.>
3. <Any guard, test, or validation to add afterward.>
---
```

After all categories are complete, print a one-line summary:

```
Analysis complete. X finding(s) across Y categor(ies).
```

---

## Heuristics & Severity

Apply these severity labels to each finding to help prioritise:

| Severity | Criteria |
|----------|----------|
| **Critical** | Can cause OOM during a normal user session (unbounded arrays, unreleased native objects, unsubscribed Firebase listeners) |
| **High** | Will cause OOM under heavy use or on low-RAM devices |
| **Medium** | Increases memory pressure; unlikely to OOM on modern devices but degrades performance |
| **Low** | Minor allocation waste; fix when refactoring |

Include the severity label in each finding heading:  
`### Finding [Critical]: notifications array grows without bound`

---

## Example Output (illustrative — do not copy verbatim)

```
## A. Unbounded collection growth

### Finding [Critical]: notifications array grows indefinitely

**File**: `src/hooks/useNotifications.js` (line 34)

**Description**
`notifications` is a React state array. Every time a new push message
arrives, `addNotification` appends to it with no eviction or cap.
After an extended session the array holds thousands of objects in the
JS heap. On low-RAM devices this reliably causes an OOM crash.

**Actionable Steps**
1. Introduce a constant `MAX_NOTIFICATIONS = 100` and trim the array on
   each append: `setNotifications(prev => [...prev, msg].slice(-MAX_NOTIFICATIONS))`.
2. Persist older notifications to AsyncStorage or a local database and
   load them on demand rather than keeping all in memory.
3. Add a `console.warn` (dev-only) when the limit is hit so it is
   visible during testing.
```

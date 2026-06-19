import {
  View,
  StyleSheet,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
  StatusBar,
} from 'react-native';

import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { SkiaIllustrator } from 'react-native-skia-illustrator';
import image from './graphpaper.png';
import { useState, useEffect, useRef } from 'react';

const TOOLS = [
  { id: 'control', label: 'Control ', icon: '↖' },
  { id: 'paint', label: 'Paint', icon: '✏' },
  { id: 'text', label: 'Text', icon: '🅰' },
  { id: 'eraser', label: 'Erase', icon: '⌫' },
  { id: 'shape', label: 'Shape', icon: '⬡' },
];

const PALETTE = [
  { name: 'black', hex: '#111111' },
  { name: 'red', hex: '#ef4444' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'green', hex: '#22c55e' },
  { name: 'orange', hex: '#f97316' },
  { name: 'purple', hex: '#a855f7' },
];

const BRUSH_SIZES = [
  { label: 'S', size: 4 },
  { label: 'M', size: 8 },
  { label: 'L', size: 16 },
  { label: 'XL', size: 28 },
];

const CONTROL_MODES = [
  { id: 'move', label: 'Move' },
  { id: 'selection', label: 'Select' },
];

const STATUS_BAR_H =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 44;

function AppContent() {
  const insets = useSafeAreaInsets();
  const [base64String, setBase64String] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState('control');
  const [activeColor, setActiveColor] = useState('black');
  const [activeBrushIdx, setActiveBrushIdx] = useState(1); // M = 8
  const [controlMode, setControlMode] = useState('selection'); // 'move' | 'selection'
  const skiaRef = useRef(null);

  const showPaintControls = activeTool === 'paint' || activeTool === 'eraser';

  const handleTool = (toolId) => {
    setActiveTool(toolId);
    skiaRef.current?.setCurrentTool(toolId === 'control' ? controlMode : toolId);
  };

  const handleControlMode = (mode) => {
    setControlMode(mode);
    skiaRef.current?.setCurrentTool(mode);
  };

  const handleColor = (name) => {
    setActiveColor(name);
    skiaRef.current?.setColour(name);
  };

  const handleBrush = (idx) => {
    setActiveBrushIdx(idx);
    skiaRef.current?.setBrushSize(BRUSH_SIZES[idx].size);
  };

  const handleSave = async () => {
    try {
      const savedUri = await skiaRef.current?.saveCanvasAsImage();
      console.log('Canvas saved to:', savedUri);
    } catch (error) {
      console.error('Error saving canvas:', error);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const uri = Image.resolveAssetSource(image).uri;
        const res = await fetch(uri);
        const buf = await res.arrayBuffer();
        const view = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < view.length; i += 8192) {
          bin += String.fromCharCode(...view.subarray(i, i + 8192));
        }
        setBase64String(btoa(bin));
      } catch (e) {
        console.error('Failed to load image:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const activeMeta = TOOLS.find((t) => t.id === activeTool);

  return (
    <View style={styles.root}>
      {loading ? (
        <ActivityIndicator
          size="large"
          color="#6366f1"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <>
          <SkiaIllustrator ref={skiaRef} imageSource={base64String} />

          {/* ── Top HUD ─────────────────────────────────────────── */}
          <View style={styles.topHud} pointerEvents="box-none">
            <View>
              <View style={styles.toolPill}>
                <Text style={styles.toolPillText}>
                  {activeMeta?.icon}
                  {'  '}
                  {activeMeta?.label}
                </Text>
              </View>
              <View style={{ height: 8 }} />
              {activeTool === 'control' && (
                <View style={styles.controlModeRow} pointerEvents="auto">
                  {CONTROL_MODES.map(({ id, label }) => {
                    const active = controlMode === id;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[
                          styles.halftoolPill,
                          active && styles.halftoolPillActive,
                        ]}
                        onPress={() => handleControlMode(id)}
                      >
                        <Text
                          style={[
                            styles.halftoolPillText,
                            active && styles.halftoolPillTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
            <View pointerEvents="auto">
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.btnText}>Save Image</Text>
              </TouchableOpacity>
              <View style={{ width: 8, height: 10 }} />
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => skiaRef.current?.clearCanvas()}
              >
                <Text style={styles.btnText}>Clear Canvas</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Bottom bar ──────────────────────────────────────── */}
          <View
            style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}
            pointerEvents="box-none"
          >
            <View
              style={{
                flex: 1,
                minWidth: 500,
                maxWidth: 600,
                alignSelf: 'center',
              }}
            >
              {/* Paint controls: visible for paint + eraser */}
              {showPaintControls && (
                <View style={styles.paintControls} pointerEvents="auto">
                  {/* Color palette */}
                  <View style={styles.row}>
                    {PALETTE.map(({ name, hex }) => (
                      <TouchableOpacity
                        key={name}
                        style={[
                          styles.swatch,
                          { backgroundColor: hex },
                          activeColor === name && styles.swatchActive,
                        ]}
                        onPress={() => handleColor(name)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      />
                    ))}

                    <View style={styles.sep} />

                    {/* Brush size */}
                    {BRUSH_SIZES.map((b, i) => (
                      <TouchableOpacity
                        key={b.label}
                        style={[
                          styles.brushBtn,
                          activeBrushIdx === i && styles.brushBtnActive,
                        ]}
                        onPress={() => handleBrush(i)}
                      >
                        <Text
                          style={[
                            styles.brushBtnText,
                            activeBrushIdx === i && styles.brushBtnTextActive,
                          ]}
                        >
                          {b.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Tool bar */}
              <View style={styles.toolbar} pointerEvents="auto">
                {TOOLS.map((tool) => {
                  const active = activeTool === tool.id;
                  return (
                    <TouchableOpacity
                      key={tool.id}
                      style={[styles.toolBtn, active && styles.toolBtnActive]}
                      onPress={() => handleTool(tool.id)}
                    >
                      <Text style={styles.toolIcon}>{tool.icon}</Text>
                      <Text
                        style={[
                          styles.toolLabel,
                          active && styles.toolLabelActive,
                        ]}
                      >
                        {tool.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#dfdfdf',
  },

  /* Top HUD */
  topHud: {
    position: 'absolute',
    top: STATUS_BAR_H + 8,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolPill: {
    backgroundColor: 'rgba(15,15,20,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  toolPillText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  halftoolPill: {
    backgroundColor: 'rgba(15,15,20,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halftoolPillActive: {
    backgroundColor: 'rgba(99,102,241,0.8)',
  },
  halftoolPillText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  halftoolPillTextActive: {
    color: '#fff',
  },
  controlModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  clearBtn: {
    backgroundColor: 'rgba(239,68,68,0.88)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  saveBtn: {
    backgroundColor: 'rgba(59,130,246,0.88)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  /* Bottom bar */
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    paddingHorizontal: 12,
    gap: 8,
  },

  /* Paint controls */
  paintControls: {
    backgroundColor: 'rgba(15,15,20,0.82)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  swatchActive: {
    borderColor: '#fff',
    transform: [{ scale: 1.18 }],
  },
  sep: {
    width: 1,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginHorizontal: 2,
  },
  brushBtn: {
    minWidth: 34,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 6,
  },
  brushBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  brushBtnText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '700',
  },
  brushBtnTextActive: {
    color: '#0f0f14',
  },

  /* Toolbar */
  toolbar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15,15,20,0.88)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  toolBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: 14,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(99,102,241,0.8)',
  },
  toolIcon: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 2,
  },
  toolLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  toolLabelActive: {
    color: '#fff',
  },
});

import { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import ColorPicker, { HueSlider, Panel1 } from 'reanimated-color-picker';
import { BrushSlider } from './BrushSlider';
import {
  BRUSH_MAX,
  BRUSH_MIN,
  FONT_MAX,
  FONT_MIN,
  PALETTE,
  SHAPES,
  TOOLS,
} from '../constants';

const SWATCH_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

function ColorPalette({
  activeColor,
  activeColour,
  expanded,
  onColor,
  onToggle,
}) {
  return (
    <View style={styles.colourSliderRow}>
      <TouchableOpacity
        style={styles.colourToggle}
        onPress={onToggle}
        activeOpacity={0.82}
      >
        <View
          style={[
            styles.colourToggleSwatch,
            { backgroundColor: activeColour?.hex ?? '#111111' },
          ]}
        />
        <FontAwesomeIcon
          icon={expanded ? faChevronUp : faChevronDown}
          size={10}
          color="rgba(255,255,255,0.75)"
        />
      </TouchableOpacity>
      <View style={styles.swatchTrack}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.swatchScroll}
          style={styles.swatchScroller}
        >
          {PALETTE.filter((colour) => colour.name !== activeColor).map(
            (colour) => (
              <TouchableOpacity
                key={colour.name}
                style={[styles.swatch, { backgroundColor: colour.hex }]}
                onPress={() => onColor(colour)}
                hitSlop={SWATCH_HIT_SLOP}
              />
            )
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function ColourControl({ activeColor, onColor }) {
  const [expanded, setExpanded] = useState(false);
  const activeColour = PALETTE.find(
    (colour) => colour.name === activeColor
  ) ?? {
    name: activeColor,
    hex: activeColor,
  };

  const handlePickerColor = ({ hex }) => {
    onColor({ name: hex, hex });
  };

  return (
    <View style={styles.colourControl}>
      <ColorPalette
        activeColor={activeColor}
        activeColour={activeColour}
        expanded={expanded}
        onColor={onColor}
        onToggle={() => setExpanded((isExpanded) => !isExpanded)}
      />
      {expanded && (
        <View style={styles.colourPickerArea}>
          <ColorPicker
            value={activeColour.hex}
            onChangeJS={handlePickerColor}
            onCompleteJS={handlePickerColor}
            style={styles.colourPicker}
            boundedThumb
            thumbSize={22}
          >
            <Panel1 style={styles.colourPickerPanel} />
            <HueSlider style={styles.colourPickerSlider} />
          </ColorPicker>
        </View>
      )}
    </View>
  );
}

function SizeControl({ label, min, max, value, onChange, compact }) {
  return (
    <View style={[styles.controlRow, compact && styles.controlRowCompact]}>
      <Text style={styles.controlLabel}>{label}</Text>
      <BrushSlider min={min} max={max} value={value} onChange={onChange} />
      <Text style={styles.controlValue}>{value}px</Text>
    </View>
  );
}

function PaintControls({
  showColorRow,
  activeColor,
  brushSize,
  onColor,
  onBrushSize,
}) {
  return (
    <View style={styles.panel} pointerEvents="auto">
      {showColorRow && (
        <ColourControl activeColor={activeColor} onColor={onColor} />
      )}
      <SizeControl
        label="Size"
        min={BRUSH_MIN}
        max={BRUSH_MAX}
        value={brushSize}
        onChange={onBrushSize}
        compact={!showColorRow}
      />
    </View>
  );
}

function ShapeControls({ activeShape, onShape }) {
  return (
    <View style={styles.panel} pointerEvents="auto">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shapeScroll}
      >
        {SHAPES.map((shape) => {
          const active = activeShape === shape.id;
          return (
            <TouchableOpacity
              key={shape.id}
              style={[styles.shapeBtn, active && styles.shapeBtnActive]}
              onPress={() => onShape(shape.id)}
            >
              <View style={styles.shapeIcon}>
                <FontAwesomeIcon icon={shape.icon} size={20} color="#fff" />
              </View>
              <Text
                style={[styles.shapeLabel, active && styles.shapeLabelActive]}
              >
                {shape.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function TextControls({ activeColor, fontSize, onColor, onFontSize }) {
  return (
    <View style={styles.panel} pointerEvents="auto">
      <ColourControl activeColor={activeColor} onColor={onColor} />
      <SizeControl
        label="Size"
        min={FONT_MIN}
        max={FONT_MAX}
        value={fontSize}
        onChange={onFontSize}
      />
    </View>
  );
}

function ToolBar({ activeTool, onTool }) {
  return (
    <View style={styles.toolbar} pointerEvents="auto">
      {TOOLS.map((tool) => {
        const active = activeTool === tool.id;
        return (
          <TouchableOpacity
            key={tool.id}
            style={[styles.toolBtn, active && styles.toolBtnActive]}
            onPress={() => onTool(tool.id)}
          >
            <View style={styles.toolIcon}>
              <FontAwesomeIcon icon={tool.icon} size={16} color="#fff" />
            </View>
            <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>
              {tool.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function BottomControls({
  activeTool,
  activeColor,
  brushSize,
  fontSize,
  activeShape,
  bottomInset,
  onTool,
  onColor,
  onBrushSize,
  onFontSize,
  onShape,
}) {
  const [optionsExpanded, setOptionsExpanded] = useState(true);
  const hasActiveOptions =
    activeTool === 'paint' ||
    activeTool === 'eraser' ||
    activeTool === 'shape' ||
    activeTool === 'text';
  const showPaintControls =
    optionsExpanded &&
    (activeTool === 'paint' ||
      activeTool === 'eraser' ||
      activeTool === 'shape');
  const showColorRow = activeTool === 'paint' || activeTool === 'shape';
  const showTextControls = optionsExpanded && activeTool === 'text';
  const showShapeControls = optionsExpanded && activeTool === 'shape';

  useEffect(() => {
    setOptionsExpanded(true);
  }, [activeTool]);

  const handleToolPress = (toolId) => {
    if (toolId === activeTool && hasActiveOptions) {
      setOptionsExpanded((expanded) => !expanded);
      return;
    }

    onTool(toolId);
  };

  return (
    <View
      style={[styles.bottomBar, { paddingBottom: bottomInset + 12 }]}
      pointerEvents="box-none"
    >
      <View style={styles.bottomContent}>
        {showPaintControls && (
          <PaintControls
            showColorRow={showColorRow}
            activeColor={activeColor}
            brushSize={brushSize}
            onColor={onColor}
            onBrushSize={onBrushSize}
          />
        )}
        {showShapeControls && (
          <ShapeControls activeShape={activeShape} onShape={onShape} />
        )}
        {showTextControls && (
          <TextControls
            activeColor={activeColor}
            fontSize={fontSize}
            onColor={onColor}
            onFontSize={onFontSize}
          />
        )}
        <ToolBar activeTool={activeTool} onTool={handleToolPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  bottomContent: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    gap: 8,
  },
  panel: {
    backgroundColor: 'rgba(15,15,20,0.82)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  colourControl: {
    gap: 10,
  },
  colourSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colourToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  colourToggleSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  colourPickerArea: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 10,
  },
  colourPicker: {
    gap: 10,
  },
  colourPickerPanel: {
    height: 120,
    borderRadius: 10,
  },
  colourPickerSlider: {
    height: 24,
    borderRadius: 12,
  },
  swatchScroll: {
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 5,
  },
  swatchTrack: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  swatchScroller: {
    flex: 1,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  controlRowCompact: {
    marginTop: 0,
  },
  controlLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    width: 40,
  },
  controlValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    width: 44,
    textAlign: 'right',
  },
  shapeScroll: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  shapeBtn: {
    width: 64,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  shapeBtnActive: {
    backgroundColor: 'rgba(99,102,241,0.8)',
  },
  shapeIcon: {
    marginBottom: 2,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '600',
  },
  shapeLabelActive: {
    color: '#fff',
  },
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
    minHeight: 48,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(99,102,241,0.8)',
  },
  toolIcon: {
    marginBottom: 2,
    minHeight: 18,
    alignItems: 'center',
    justifyContent: 'center',
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

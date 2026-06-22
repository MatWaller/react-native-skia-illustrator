/* global btoa */

import { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { SkiaIllustrator } from 'react-native-skia-illustrator';

import { TOOLS } from './constants';
import { BottomControls } from './components/BottomControls';
import { TopHud } from './components/TopHud';
import image from './graphpaper.png';

function AppContent() {
  const insets = useSafeAreaInsets();
  const [base64String, setBase64String] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState('control');
  const [activeColor, setActiveColor] = useState('black');
  const [brushSize, setBrushSize] = useState(8);
  const [fontSize, setFontSize] = useState(32);
  const [activeShape, setActiveShape] = useState('rect');
  const [hasSelectedShape, setHasSelectedShape] = useState(false);
  const skiaRef = useRef(null);

  const activeMeta = TOOLS.find((tool) => tool.id === activeTool);

  const handleTool = (toolId) => {
    skiaRef.current?.setCurrentTool(toolId);
    skiaRef.current?.clearSelection();
  };

  const handleColor = ({ name, hex }) => {
    setActiveColor(name);
    skiaRef.current?.setColour(hex);
  };

  const handleBrushSize = (size) => {
    setBrushSize(size);
    skiaRef.current?.setBrushSize(size);
  };

  const handleFontSize = (size) => {
    setFontSize(size);
    skiaRef.current?.setFontSize?.(size);
  };

  const handleShape = (id) => {
    setActiveShape(id);
    skiaRef.current?.setShape?.(id);
  };

  const handleToolChange = (tool) => {
    if (tool === 'selection' || tool === 'move' || tool === 'control') {
      setActiveTool('control');
      return;
    }
    setActiveTool(tool);
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
    const loadGraphPaper = async () => {
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
      } catch (error) {
        console.error('Failed to load image:', error);
      } finally {
        setLoading(false);
      }
    };
    loadGraphPaper();
  }, []);

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
          <StatusBar
            barStyle="dark-content"
            backgroundColor="#dfdfdf"
            hidden={true}
          />
          <SkiaIllustrator
            ref={skiaRef}
            imageSource={base64String}
            onToolChange={handleToolChange}
            onSelectedShapeChange={setHasSelectedShape}
          />

          <TopHud
            activeMeta={activeMeta}
            activeTool={activeTool}
            onSave={handleSave}
            onClear={() => skiaRef.current?.clearCanvas()}
            onDeleteSelectedShape={() => skiaRef.current?.deleteSelectedShape()}
            topInset={insets.top}
            hasSelectedShape={hasSelectedShape}
          />
          <BottomControls
            activeTool={activeTool}
            activeColor={activeColor}
            brushSize={brushSize}
            fontSize={fontSize}
            activeShape={activeShape}
            bottomInset={insets.bottom}
            onTool={handleTool}
            onColor={handleColor}
            onBrushSize={handleBrushSize}
            onFontSize={handleFontSize}
            onShape={handleShape}
          />
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
});

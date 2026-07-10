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
import RNFS from 'react-native-fs';
import { SkiaIllustrator } from 'react-native-skia-illustrator';

import { TOOLS, ICONS } from './constants';
import { BottomControls } from './components/BottomControls';
import { TopHud } from './components/TopHud';
import image from './graphpaper.png';

const PROJECT_FILE = `${RNFS.DocumentDirectoryPath}/illustrator_project.cdi`;

function AppContent() {
  const insets = useSafeAreaInsets();
  const [base64String, setBase64String] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState('control');
  const [activeColor, setActiveColor] = useState('black');
  const [brushSize, setBrushSize] = useState(8);
  const [fontSize, setFontSize] = useState(32);
  const [activeShape, setActiveShape] = useState('rect');
  const [activeIcon, setActiveIcon] = useState(ICONS[0]?.id ?? null);
  const [hasSelectedShape, setHasSelectedShape] = useState(false);
  const [initialProjectData, setInitialProjectData] = useState(null);
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

  const handleIcon = (icon) => {
    setActiveIcon(icon.id);
    skiaRef.current?.setIcon?.({
      iconName: icon.id,
      iconPath: icon.iconPath,
      iconViewBox: icon.iconViewBox,
    });
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

  const handleSaveProject = async () => {
    try {
      const json = skiaRef.current?.serializeCanvas();
      if (!json) return;
      await RNFS.writeFile(PROJECT_FILE, json, 'utf8');
      console.log('Project saved to:', PROJECT_FILE);
    } catch (error) {
      console.error('Error saving project:', error);
    }
  };

  const handleLoadProject = async () => {
    try {
      const exists = await RNFS.exists(PROJECT_FILE);
      if (!exists) {
        console.warn('No saved project found at:', PROJECT_FILE);
        return;
      }
      const json = await RNFS.readFile(PROJECT_FILE, 'utf8');
      skiaRef.current?.loadCanvas(json);
    } catch (error) {
      console.error('Error loading project:', error);
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
      }

      try {
        const exists = await RNFS.exists(PROJECT_FILE);
        if (exists) {
          const json = await RNFS.readFile(PROJECT_FILE, 'utf8');
          setInitialProjectData(json);
        }
      } catch (error) {
        console.error('Error reading project file:', error);
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
            initialData={initialProjectData}
            onToolChange={handleToolChange}
            onSelectedShapeChange={setHasSelectedShape}
            textModalProps={textModalProps}
            pathToShape={true}
            autoSave={handleSaveProject}
            defaultSettings={{
              tool: 'paint',
              shape: 'line',
              brushSize: 8,
              fontSize: 32,
              brushColour: 'black',
              highlighterColour: 'yellow',
              iconName: 'location-dot',
            }}
          />
          <TopHud
            activeMeta={activeMeta}
            activeTool={activeTool}
            onSave={handleSave}
            onSaveProject={handleSaveProject}
            onLoadProject={handleLoadProject}
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
            hasSelectedShape={hasSelectedShape}
            onTool={handleTool}
            onColor={handleColor}
            onBrushSize={handleBrushSize}
            onFontSize={handleFontSize}
            onShape={handleShape}
            onIcon={handleIcon}
            activeIcon={activeIcon}
            onDeleteSelectedShape={() => skiaRef.current?.deleteSelectedShape()}
            onBringShapeForward={() => skiaRef.current?.bringShapeForward()}
            onSendShapeBackward={() => skiaRef.current?.sendShapeBackward()}
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

// MW - Themed text-entry overlay matching the host modal styling. Passed
// straight through to <SkiaIllustrator textModalProps={...} />.
const textModalProps = {
  brandData: {
    primarycolour: '#1f5f8b',
  },
  createTitle: 'Add text',
  editTitle: 'Edit text',
  placeholder: 'Type something…',
  submitLabel: 'Place',
};

import { Platform, StatusBar } from 'react-native';
import {
  faArrowPointer,
  faArrowUp,
  faCircle,
  faDiamond,
  faCheck,
  faXmark,
  faEraser,
  faFont,
  faMinus,
  faPen,
  faPlay,
  faShapes,
  faSquare,
  faStar,
} from '@fortawesome/free-solid-svg-icons';

export const TOOLS = [
  { id: 'control', label: 'Control', icon: faArrowPointer },
  { id: 'paint', label: 'Paint', icon: faPen },
  { id: 'text', label: 'Text', icon: faFont },
  { id: 'eraser', label: 'Erase', icon: faEraser },
  { id: 'shape', label: 'Shape', icon: faShapes },
];

export const PALETTE = [
  { name: 'black', hex: '#111111' },
  { name: 'white', hex: '#ffffff' },
  { name: 'gray', hex: '#9ca3af' },
  { name: 'red', hex: '#ef4444' },
  { name: 'orange', hex: '#f97316' },
  { name: 'amber', hex: '#f59e0b' },
  { name: 'yellow', hex: '#eab308' },
  { name: 'green', hex: '#22c55e' },
  { name: 'teal', hex: '#14b8a6' },
  { name: 'cyan', hex: '#06b6d4' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'indigo', hex: '#6366f1' },
  { name: 'purple', hex: '#a855f7' },
  { name: 'pink', hex: '#ec4899' },
  { name: 'brown', hex: '#92400e' },
];

export const SHAPES = [
  { id: 'rect', label: 'Rect', icon: faSquare },
  { id: 'circle', label: 'Circle', icon: faCircle },
  { id: 'triangle', label: 'Triangle', icon: faPlay },
  { id: 'line', label: 'Line', icon: faMinus },
  { id: 'arrow', label: 'Arrow', icon: faArrowUp },
  { id: 'star', label: 'Star', icon: faStar },
  { id: 'diamond', label: 'Diamond', icon: faDiamond },
  { id: 'check', label: 'Check', icon: faCheck },
  { id: 'cross', label: 'Cross', icon: faXmark },
];

export const CONTROL_MODES = [
  { id: 'move', label: 'Move' },
  { id: 'selection', label: 'Select' },
];

export const BRUSH_MIN = 2;
export const BRUSH_MAX = 40;
export const FONT_MIN = 12;
export const FONT_MAX = 96;

export const STATUS_BAR_H =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 44;

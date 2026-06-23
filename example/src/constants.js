import { Platform, StatusBar } from 'react-native';
import {
  faHandPointDown,
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
  faLocationDot,
  faTriangleExclamation,
  faCircleExclamation,
  faFlag,
  faCamera,
  faWrench,
  faFire,
  faDroplet,
  faBolt,
  faTree,
  faTruck,
  faBuilding,
  faArrowsLeftRight,
  faCircleQuestion,
} from '@fortawesome/free-solid-svg-icons';

function _iconPath(fa) {
  const d = fa.icon[4];
  return Array.isArray(d) ? d.join(' ') : d;
}
function _iconVB(fa) {
  return { width: fa.icon[0], height: fa.icon[1] };
}

export const TOOLS = [
  { id: 'control', label: 'Control', icon: faHandPointDown },
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

export const ICONS = [
  {
    id: 'location-dot',
    label: 'Location',
    icon: faLocationDot,
    iconPath: _iconPath(faLocationDot),
    iconViewBox: _iconVB(faLocationDot),
  },
  {
    id: 'circle-poi',
    label: 'Point',
    icon: faCircle,
    iconPath: _iconPath(faCircle),
    iconViewBox: _iconVB(faCircle),
  },
  {
    id: 'xmark-icon',
    label: 'Fault',
    icon: faXmark,
    iconPath: _iconPath(faXmark),
    iconViewBox: _iconVB(faXmark),
  },
  {
    id: 'check-icon',
    label: 'Pass',
    icon: faCheck,
    iconPath: _iconPath(faCheck),
    iconViewBox: _iconVB(faCheck),
  },
  {
    id: 'triangle-exclamation',
    label: 'Hazard',
    icon: faTriangleExclamation,
    iconPath: _iconPath(faTriangleExclamation),
    iconViewBox: _iconVB(faTriangleExclamation),
  },
  {
    id: 'circle-exclamation',
    label: 'Note',
    icon: faCircleExclamation,
    iconPath: _iconPath(faCircleExclamation),
    iconViewBox: _iconVB(faCircleExclamation),
  },
  {
    id: 'arrow-up-icon',
    label: 'Direction',
    icon: faArrowUp,
    iconPath: _iconPath(faArrowUp),
    iconViewBox: _iconVB(faArrowUp),
  },
  {
    id: 'star-icon',
    label: 'Priority',
    icon: faStar,
    iconPath: _iconPath(faStar),
    iconViewBox: _iconVB(faStar),
  },
  {
    id: 'flag',
    label: 'Flag',
    icon: faFlag,
    iconPath: _iconPath(faFlag),
    iconViewBox: _iconVB(faFlag),
  },
  {
    id: 'camera',
    label: 'Camera',
    icon: faCamera,
    iconPath: _iconPath(faCamera),
    iconViewBox: _iconVB(faCamera),
  },
  {
    id: 'wrench',
    label: 'Repair',
    icon: faWrench,
    iconPath: _iconPath(faWrench),
    iconViewBox: _iconVB(faWrench),
  },
  {
    id: 'fire',
    label: 'Fire',
    icon: faFire,
    iconPath: _iconPath(faFire),
    iconViewBox: _iconVB(faFire),
  },
  {
    id: 'droplet',
    label: 'Water',
    icon: faDroplet,
    iconPath: _iconPath(faDroplet),
    iconViewBox: _iconVB(faDroplet),
  },
  {
    id: 'bolt',
    label: 'Electrical',
    icon: faBolt,
    iconPath: _iconPath(faBolt),
    iconViewBox: _iconVB(faBolt),
  },
  {
    id: 'tree',
    label: 'Vegetation',
    icon: faTree,
    iconPath: _iconPath(faTree),
    iconViewBox: _iconVB(faTree),
  },
  {
    id: 'truck',
    label: 'Access',
    icon: faTruck,
    iconPath: _iconPath(faTruck),
    iconViewBox: _iconVB(faTruck),
  },
  {
    id: 'building',
    label: 'Structure',
    icon: faBuilding,
    iconPath: _iconPath(faBuilding),
    iconViewBox: _iconVB(faBuilding),
  },
  {
    id: 'arrows-left-right',
    label: 'Span',
    icon: faArrowsLeftRight,
    iconPath: _iconPath(faArrowsLeftRight),
    iconViewBox: _iconVB(faArrowsLeftRight),
  },
  {
    id: 'circle-question',
    label: 'Unknown',
    icon: faCircleQuestion,
    iconPath: _iconPath(faCircleQuestion),
    iconViewBox: _iconVB(faCircleQuestion),
  },
];

export const BRUSH_MIN = 2;
export const BRUSH_MAX = 40;
export const FONT_MIN = 12;
export const FONT_MAX = 96;

export const STATUS_BAR_H =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 44;

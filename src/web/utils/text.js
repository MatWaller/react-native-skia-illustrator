// MW - Browser text measuring and highlighter colour helpers.

export const isBrowser = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

const createMeasureContext = () => {
  if (!isBrowser()) return null;
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
};

// MW - Measures text using a scratch canvas so text shapes get an accurate
// width/height without ever rendering anything to screen.
export const measureWebText = (content, fontSize) => {
  const ctx = createMeasureContext();
  if (!ctx)
    return { width: (content ?? '').length * fontSize * 0.6, height: fontSize };
  ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  return { width: ctx.measureText(content ?? '').width, height: fontSize };
};

// MW - 50% alpha so a highlighter reads as translucent instead of opaque ink.
export const withHighlighterAlpha = (colour) =>
  colour && colour.length === 7 && colour.startsWith('#')
    ? `${colour}80`
    : colour;

// MW - Viewport plumbing: host resize tracking, fit-to-view transform,
// background image loading and wheel-to-zoom.

import React from 'react';
import { clamp } from '../constants';
import { isBrowser } from '../utils/text';

export const useViewportSetup = ({
  hostRef,
  canvasRef,
  stateRef,
  viewportSize,
  setViewportSize,
  setCanvasReady,
  resolvedCanvas,
  setResolvedCanvas,
  setTransform,
  canvasWidth,
  canvasHeight,
  imageSource,
  imageRef,
}) => {
  // MW - Track the host element's size so the canvas always fills it.
  React.useEffect(() => {
    if (
      !hostRef.current ||
      typeof window === 'undefined' ||
      typeof window.ResizeObserver === 'undefined'
    )
      return undefined;
    const observer = new window.ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = {
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      };
      setViewportSize(next);
      setCanvasReady(true);
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [hostRef, setViewportSize, setCanvasReady]);

  // MW - Whenever the paper size or viewport changes, re-fit and re-centre
  // the paper inside the viewport.
  React.useEffect(() => {
    const FIT_MARGIN = 0.9;
    const fitScale =
      resolvedCanvas.width > 0 && resolvedCanvas.height > 0
        ? clamp(
            Math.min(
              viewportSize.width / resolvedCanvas.width,
              viewportSize.height / resolvedCanvas.height
            ) * FIT_MARGIN,
            0.1,
            12
          )
        : 1;
    setTransform({
      scale: fitScale,
      x: (viewportSize.width - resolvedCanvas.width * fitScale) / 2,
      y: (viewportSize.height - resolvedCanvas.height * fitScale) / 2,
    });
  }, [
    resolvedCanvas.width,
    resolvedCanvas.height,
    viewportSize.width,
    viewportSize.height,
    setTransform,
  ]);

  // MW - Load the background image (if any) and resolve the paper size from
  // its natural dimensions, falling back to the given canvasWidth/Height.
  React.useEffect(() => {
    if (!imageSource || !isBrowser()) {
      imageRef.current = null;
      setResolvedCanvas({ width: canvasWidth, height: canvasHeight });
      return undefined;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      setResolvedCanvas({
        width: img.naturalWidth || canvasWidth,
        height: img.naturalHeight || canvasHeight,
      });
    };
    img.onerror = () => {
      if (cancelled) return;
      imageRef.current = null;
      setResolvedCanvas({ width: canvasWidth, height: canvasHeight });
    };
    img.src = imageSource;
    return () => {
      cancelled = true;
    };
  }, [canvasWidth, canvasHeight, imageSource, imageRef, setResolvedCanvas]);

  // MW - Wheel zooms towards the pointer position rather than the paper
  // origin, so the point under the cursor stays put.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      const current = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = {
        x: (sx - current.transform.x) / current.transform.scale,
        y: (sy - current.transform.y) / current.transform.scale,
      };
      const nextScale = clamp(
        current.transform.scale * (event.deltaY < 0 ? 1.1 : 0.9),
        0.1,
        12
      );
      setTransform({
        scale: nextScale,
        x: sx - before.x * nextScale,
        y: sy - before.y * nextScale,
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [canvasRef, stateRef, setTransform]);
};

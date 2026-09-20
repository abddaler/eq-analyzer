import { useEffect, useRef } from 'react';

export type DrawFn = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

export interface PointerInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  phase: 'down' | 'move' | 'up';
}

interface Props {
  draw: DrawFn;
  /** Redraw every animation frame; off for static plots. */
  animate?: boolean;
  /** CSS height; the width always fills the parent. */
  height?: number | string;
  className?: string;
  onPointer?: (info: PointerInfo) => void;
  ariaLabel?: string;
}

/**
 * Canvas with device-pixel-ratio scaling and an optional rAF loop.
 *
 * The draw callback is kept in a ref so a re-render never restarts the loop -
 * on a phone a dropped frame is visible, and the spectrum must not stutter
 * because a label above it changed.
 */
export function Canvas({ draw, animate = false, height = 200, className, onPointer, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const pointerRef = useRef(onPointer);
  pointerRef.current = onPointer;
  const sizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let frame = 0;
    let disposed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      sizeRef.current = { width: rect.width, height: rect.height };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = () => {
      resize();
      const { width, height: h } = sizeRef.current;
      ctx.save();
      drawRef.current(ctx, width, h);
      ctx.restore();
    };

    const loop = () => {
      if (disposed) return;
      render();
      frame = requestAnimationFrame(loop);
    };

    if (animate) {
      frame = requestAnimationFrame(loop);
    } else {
      render();
    }

    const observer = new ResizeObserver(() => {
      if (!animate) render();
    });
    observer.observe(canvas);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [animate]);

  // Static canvases have to be told when their inputs changed.
  useEffect(() => {
    if (animate) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;
    const { width, height: h } = sizeRef.current;
    if (width > 0) {
      ctx.save();
      drawRef.current(ctx, width, h);
      ctx.restore();
    }
  }, [draw, animate]);

  const emit = (event: React.PointerEvent<HTMLCanvasElement>, phase: PointerInfo['phase']) => {
    const handler = pointerRef.current;
    if (!handler) return;
    const rect = event.currentTarget.getBoundingClientRect();
    handler({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      phase,
    });
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: typeof height === 'number' ? `${height}px` : height }}
      aria-label={ariaLabel}
      role="img"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        emit(e, 'down');
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0 || e.pointerType === 'touch') emit(e, 'move');
      }}
      onPointerUp={(e) => emit(e, 'up')}
    />
  );
}

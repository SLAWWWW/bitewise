'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import type { Globe } from 'cobe';
import { useMotion } from './useMotion';
import s from './landing.module.css';

/** The original illustration remains a fallback when WebGL is unavailable. */
export function RevolvingGlobe() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useMotion(root);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const rotation = useRef(2.5);
  const tilt = useRef(0.15);
  const running = useRef(false);
  const dragging = useRef(false);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const globeRef = useRef<Globe | null>(null);
  const updatePlayback = useRef<(() => void) | null>(null);
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    running.current = motion.running;
    updatePlayback.current?.();
  }, [motion.running]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !motion.visible) return;
    let disposed = false;
    let globe: Globe | undefined;
    let frame = 0;
    let previous = 0;
    let resize: ResizeObserver | undefined;

    function draw(now: number) {
      if (disposed || !running.current || !globe) return;
      // Time-based rotation stays equally slow on 60Hz and 120Hz displays.
      if (previous && !dragging.current) rotation.current = (rotation.current + Math.min(now - previous, 50) * 0.00016) % (2 * Math.PI);
      previous = now;
      globe.update({ phi: rotation.current, theta: tilt.current });
      frame = requestAnimationFrame(draw);
    }
    function syncPlayback() {
      cancelAnimationFrame(frame);
      previous = 0;
      if (running.current) frame = requestAnimationFrame(draw);
    }
    function onContextLost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      setReady(false);
      setUnavailable(true);
    }

    void import('cobe').then(({ default: createGlobe }) => {
      if (disposed) return;
      const context = { alpha: true, antialias: true, depth: false, stencil: false };
      const gl = element.getContext('webgl2', context) ?? element.getContext('webgl', context);
      if (!gl) { setUnavailable(true); return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = element.getBoundingClientRect().width;
      globe = createGlobe(element, {
        devicePixelRatio: dpr, width, height: width,
        phi: rotation.current, theta: tilt.current, dark: 1, diffuse: 1.2,
        mapSamples: 24000, mapBrightness: 7, mapBaseBrightness: 0,
        baseColor: [0.12, 0.42, 0.36], markerColor: [1, 0.74, 0.28], glowColor: [0.03, 0.18, 0.16],
        scale: 1.05, opacity: 1, context,
        markers: [
          { location: [-6.2, 106.8], size: 0.045 },
          { location: [-2.99, 104.76], size: 0.035 },
          { location: [-5.15, 119.43], size: 0.035 },
          { location: [-4.55, 136.89], size: 0.035 },
        ],
        arcs: [
          { from: [-2.99, 104.76], to: [-6.2, 106.8] },
          { from: [-6.2, 106.8], to: [-5.15, 119.43] },
          { from: [-5.15, 119.43], to: [-4.55, 136.89] },
        ],
        arcColor: [0.96, 0.43, 0.3], arcWidth: 0.45, arcHeight: 0.18,
      });
      globeRef.current = globe;
      resize = new ResizeObserver(() => {
        const size = element.getBoundingClientRect().width;
        globe?.update({ width: size, height: size });
      });
      resize.observe(element);
      element.addEventListener('webglcontextlost', onContextLost);
      updatePlayback.current = syncPlayback;
      setReady(true);
      setUnavailable(false);
      syncPlayback();
    }).catch(() => {
      if (!disposed) { setReady(false); setUnavailable(true); }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      element.removeEventListener('webglcontextlost', onContextLost);
      updatePlayback.current = null;
      globeRef.current = null;
      globe?.destroy();
    };
  }, [motion.visible]);

  const rendered = ready && motion.visible && !unavailable;
  function updateGlobe(phiDelta: number, thetaDelta: number) {
    rotation.current = (rotation.current + phiDelta) % (2 * Math.PI);
    tilt.current = Math.max(-0.85, Math.min(0.85, tilt.current + thetaDelta));
    globeRef.current?.update({ phi: rotation.current, theta: tilt.current });
  }
  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!rendered) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dragging.current = true;
    setInteracting(true);
  }
  function drag(event: PointerEvent<HTMLCanvasElement>) {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    updateGlobe((event.clientX - active.x) * 0.008, (event.clientY - active.y) * 0.005);
    pointer.current = { ...active, x: event.clientX, y: event.clientY };
  }
  function endDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    dragging.current = false;
    setInteracting(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function rotateWithKeyboard(event: KeyboardEvent<HTMLCanvasElement>) {
    const movement = 0.12;
    if (event.key === 'ArrowLeft') updateGlobe(-movement, 0);
    else if (event.key === 'ArrowRight') updateGlobe(movement, 0);
    else if (event.key === 'ArrowUp') updateGlobe(0, -movement);
    else if (event.key === 'ArrowDown') updateGlobe(0, movement);
    else return;
    event.preventDefault();
  }

  return <div ref={root} className={s.globeRenderer} data-testid="revolving-globe" data-ready={rendered} data-motion={motion.running && rendered ? 'running' : 'paused'} data-interaction={interacting ? 'dragging' : 'idle'}>
    <Image src="/landing/network-globe.webp" width={1586} height={992} alt={rendered ? '' : 'Dotted Earth with illustrative connections across Indonesia'} aria-hidden={rendered || undefined} sizes="(max-width: 760px) 100vw, 940px" className={s.globe} style={{ opacity: rendered ? 0 : 1 }} />
    <canvas
      ref={canvas}
      className={s.globeCanvas}
      role="img"
      aria-label="Interactive globe showing Lumbung's food redistribution network. Drag or use the arrow keys to rotate it."
      aria-hidden={!rendered}
      tabIndex={rendered ? 0 : -1}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={rotateWithKeyboard}
      style={{ opacity: rendered ? 1 : 0 }}
    />
    {rendered && <span className={s.globeHint} aria-hidden="true">Drag to explore · Arrow keys to rotate</span>}
    {!unavailable && <button type="button" className={`${s.motionButton} ${s.globeControl}`} onClick={motion.toggle} aria-label={motion.enabled ? 'Pause globe rotation' : 'Play globe rotation'}>
      {motion.enabled ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
      {motion.enabled ? 'Pause globe rotation' : 'Play globe rotation'}
    </button>}
  </div>;
}

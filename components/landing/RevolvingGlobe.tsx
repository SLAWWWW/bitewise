'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
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
  const running = useRef(false);
  const updatePlayback = useRef<(() => void) | null>(null);

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
      if (previous) rotation.current = (rotation.current + Math.min(now - previous, 50) * 0.00016) % (2 * Math.PI);
      previous = now;
      globe.update({ phi: rotation.current });
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
        phi: rotation.current, theta: 0.15, dark: 1, diffuse: 1.2,
        mapSamples: 24000, mapBrightness: 7, mapBaseBrightness: 0,
        baseColor: [0.45, 0.45, 0.45], markerColor: [1, 1, 1], glowColor: [0.08, 0.08, 0.08],
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
        arcColor: [0.8, 0.8, 0.8], arcWidth: 0.45, arcHeight: 0.18,
      });
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
      globe?.destroy();
    };
  }, [motion.visible]);

  const rendered = ready && motion.visible && !unavailable;
  return <div ref={root} className={s.globeRenderer} data-testid="revolving-globe" data-ready={rendered} data-motion={motion.running && rendered ? 'running' : 'paused'}>
    <Image src="/landing/network-globe.webp" width={1586} height={992} alt="Dotted Earth with illustrative connections across Indonesia" sizes="(max-width: 760px) 100vw, 940px" className={s.globe} style={{ opacity: rendered ? 0 : 1 }} />
    <canvas ref={canvas} className={s.globeCanvas} aria-hidden="true" style={{ opacity: rendered ? 1 : 0 }} />
    {!unavailable && <button type="button" className={`${s.motionButton} ${s.globeControl}`} onClick={motion.toggle} aria-label={motion.enabled ? 'Pause globe rotation' : 'Play globe rotation'}>
      {motion.enabled ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
      {motion.enabled ? 'Pause globe rotation' : 'Play globe rotation'}
    </button>}
  </div>;
}

import React, { useEffect, useRef } from 'react';

/*
 * "Rising Marks" login background.
 * Neon grades and symbols float upward at different depths, swaying slightly; the cursor pushes them aside.
 * One full-screen <canvas>, drawn with requestAnimationFrame. Each symbol's glow is pre-rendered once to an
 * offscreen canvas, so a frame is just ~60-130 drawImage calls.
 * Pauses while the tab is hidden; draws a single still frame when the user prefers reduced motion.
 */

const SYMBOLS = ['A+', 'A', 'B+', '4.0', '5/5', '✓', '★', 'Σ', 'π', 'σ', 'x̄', '%', '≈', '∫', '√', '→', '100'];

// [core text color, glow color]
const PALETTE = [
  ['#ffd2a3', '#e87500'], // UTD orange
  ['#ffc58a', '#ff8a1f'], // bright orange
  ['#d6ffe7', '#4fbf83'], // green
  ['#c9ffe0', '#7fdca6'], // mint green
];

const PUSH_RADIUS = 150;  // px around the cursor that symbols are pushed out of
const PUSH_STRENGTH = 900;
const SPRING = 2.2;       // how quickly a pushed symbol drifts back to its lane
const DAMPING = 3.2;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeSprite(text, size, [core, glow], dpr) {
  const font = `800 ${size}px 'Manrope Variable', 'Manrope', system-ui, sans-serif`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const pad = Math.ceil(size * 0.9); // room for the glow
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.3) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = core;
  ctx.shadowColor = glow;
  // Layered blurs give the neon tube look: a wide halo, a tighter glow, then a crisp core.
  ctx.shadowBlur = size * 0.9; ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = size * 0.4; ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = size * 0.12; ctx.fillText(text, w / 2, h / 2);
  return { canvas, w, h };
}

// Lanes keep the spread even: the screen width is split into one lane per symbol, and each symbol (and every
// symbol that replaces it) stays in its own lane, so the left, middle and right always hold equal shares.
const laneX = (lane, lanes, width) => ((lane + rand(0.15, 0.85)) / lanes) * width;

// Shuffled 0..n-1, used to give the starting symbols evenly spaced heights in a random order.
function shuffledSlots(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// slot: when given, the symbol starts at that evenly spaced height on screen; otherwise it enters from below.
function makeMark(width, height, dpr, lane, lanes, slot) {
  const depth = rand(0.35, 1); // 1 = closest: bigger, faster, brighter
  const size = Math.round(12 + depth * 26);
  return {
    sprite: makeSprite(pick(SYMBOLS), size, pick(PALETTE), dpr),
    depth,
    lane,
    x: laneX(lane, lanes, width),
    y: slot === undefined ? height + rand(20, 120) : ((slot + rand(0.1, 0.9)) / lanes) * height,
    speed: 10 + depth * 32,             // px per second, upward
    alpha: 0.22 + depth * 0.6,
    swayAmp: rand(6, 22),
    swayFreq: rand(0.25, 0.7),
    phase: rand(0, Math.PI * 2),
    tilt: rand(-0.25, 0.25),
    ox: 0, oy: 0, vx: 0, vy: 0,         // cursor push offset and its velocity
  };
}

export default function LoginBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0, height = 0, dpr = 1;
    let marks = [];
    let raf = 0;
    let last = 0;
    let time = 0;
    let disposed = false;
    let rebuildTimer = 0;
    const mouse = { x: -9999, y: -9999, active: false };

    // Roughly one symbol per 14,000 px² of screen (≈130 on a 1080p window), between 60 and 130.
    const targetCount = () => Math.max(60, Math.min(130, Math.round((width * height) / 14000)));

    const resize = () => {
      const prevW = width, prevH = height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const n = targetCount();
      // Stretch positions to the new size right away, which keeps every symbol in its lane.
      if (marks.length && prevW && prevH) {
        for (const m of marks) { m.x *= width / prevW; m.y *= height / prevH; }
        // If the count should change, rebuild once the window stops resizing (avoids flicker mid-drag).
        clearTimeout(rebuildTimer);
        if (marks.length !== n) rebuildTimer = setTimeout(() => { if (!disposed) { rebuild(); if (reduceMotion) draw(); } }, 250);
        return;
      }
      rebuild();
    };

    // Build the full set so the lanes match the count and the spread stays even.
    const rebuild = () => {
      const n = targetCount();
      const slots = shuffledSlots(n);
      marks = Array.from({ length: n }, (_, i) => makeMark(width, height, dpr, i, n, slots[i]));
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter'; // overlapping glows add up like real neon
      for (const m of marks) {
        const sway = Math.sin(time * m.swayFreq + m.phase);
        const x = m.x + sway * m.swayAmp + m.ox;
        const y = m.y + m.oy;
        ctx.globalAlpha = m.alpha;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(m.tilt + sway * 0.08);
        ctx.drawImage(m.sprite.canvas, -m.sprite.w / 2, -m.sprite.h / 2, m.sprite.w, m.sprite.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    const step = (dt) => {
      time += dt;
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        m.y -= m.speed * dt;

        // Cursor push: closer symbols (higher depth) react more strongly.
        if (mouse.active) {
          const dx = m.x + m.ox - mouse.x;
          const dy = m.y + m.oy - mouse.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < PUSH_RADIUS) {
            const f = (1 - dist / PUSH_RADIUS) ** 2 * PUSH_STRENGTH * (0.4 + m.depth);
            m.vx += (dx / dist) * f * dt;
            m.vy += (dy / dist) * f * dt;
          }
        }
        // Spring back toward the symbol's own lane.
        m.vx += (-m.ox * SPRING - m.vx * DAMPING) * dt;
        m.vy += (-m.oy * SPRING - m.vy * DAMPING) * dt;
        m.ox += m.vx * dt;
        m.oy += m.vy * dt;

        if (m.y + m.oy < -60) marks[i] = makeMark(width, height, dpr, m.lane, marks.length);
      }
    };

    const frame = (now) => {
      if (disposed) return;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (reduceMotion || raf || disposed) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; };
    const onLeave = () => { mouse.active = false; };
    const onResize = () => { resize(); if (reduceMotion) draw(); };

    // Wait for the web font so the pre-rendered sprites use it.
    (document.fonts?.ready || Promise.resolve()).then(() => {
      if (disposed) return;
      resize();
      draw();
      start();
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      clearTimeout(rebuildTimer);
      stop();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="login-bg" aria-hidden="true" />;
}

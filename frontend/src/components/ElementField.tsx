import { useEffect, useRef } from 'react';
import type { Element } from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
}
interface Ripple {
  x: number;
  y: number;
  r: number;
  a: number;
}

/** Living backdrop for the hero: rising embers in Fire, ripples in Water. Follows the pointer. */
export function ElementField({ element, reduced }: { element: Element; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ x: number; y: number; active: boolean }>({ x: 0.5, y: 0.7, active: false });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const particles: Particle[] = [];
    const ripples: Ripple[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const spawn = (): Particle => {
      const fire = element === 'fire';
      return {
        x: Math.random() * w,
        y: h + 10,
        vx: (Math.random() - 0.5) * 0.3,
        vy: fire ? -(0.6 + Math.random() * 1.4) : -(0.2 + Math.random() * 0.5),
        r: fire ? 0.8 + Math.random() * 2.2 : 1 + Math.random() * 3,
        life: 0,
        max: 180 + Math.random() * 260,
      };
    };
    const count = Math.round(Math.min(110, Math.max(40, (w * h) / 9000)));
    for (let i = 0; i < count; i++) {
      const p = spawn();
      p.y = Math.random() * h;
      p.life = Math.random() * p.max;
      particles.push(p);
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const fire = element === 'fire';
      const px = pointer.current.x * w;
      const py = pointer.current.y * h;

      for (const p of particles) {
        p.life += 1;
        if (fire) {
          // embers lean away from the pointer, like heat pushed by a hand
          const dx = p.x - px;
          const dy = p.y - py;
          const d2 = dx * dx + dy * dy;
          if (pointer.current.active && d2 < 160 * 160) {
            const f = (1 - Math.sqrt(d2) / 160) * 0.35;
            p.vx += (dx / (Math.sqrt(d2) + 1)) * f;
          }
          p.vx += (Math.random() - 0.5) * 0.05;
          p.vx *= 0.97;
        } else {
          p.vx = Math.sin((p.life + p.x) / 60) * 0.25;
        }
        p.x += p.vx;
        p.y += p.vy;
        const t = p.life / p.max;
        const alpha = Math.max(0, Math.sin(Math.PI * Math.min(1, t))) * (fire ? 0.9 : 0.45);
        if (fire) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
          g.addColorStop(0, `rgba(255, 214, 140, ${alpha})`);
          g.addColorStop(0.35, `rgba(245, 120, 35, ${alpha * 0.7})`);
          g.addColorStop(1, 'rgba(210, 56, 30, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = `rgba(150, 230, 225, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (p.life > p.max || p.y < -20) Object.assign(p, spawn());
      }

      if (!fire) {
        if (Math.random() < 0.02) ripples.push({ x: Math.random() * w, y: h * (0.6 + Math.random() * 0.4), r: 2, a: 0.5 });
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          r.r += 1.1;
          r.a *= 0.985;
          ctx.strokeStyle = `rgba(35, 165, 160, ${r.a})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(r.x, r.y, r.r * 2.2, r.r * 0.6, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (r.a < 0.02) ripples.splice(i, 1);
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();

    const parent = canvas.parentElement;
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, active: true };
      if (element === 'water' && Math.random() < 0.08) ripples.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, r: 2, a: 0.45 });
    };
    const onLeave = () => (pointer.current.active = false);
    parent?.addEventListener('pointermove', onMove);
    parent?.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      parent?.removeEventListener('pointermove', onMove);
      parent?.removeEventListener('pointerleave', onLeave);
    };
  }, [element, reduced]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

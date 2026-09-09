import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";

type Particle = { x: number; y: number; vx: number; vy: number; size: number; hue: number };
export function PlaygroundApp() {
  const initial = new URLSearchParams(location.hash.split("?")[1]).get("scene");
  const [scene, setScene] = useState(initial === "constellation" ? "constellation" : "orbit");
  const [paused, setPaused] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [repel, setRepel] = useState(false);
  const [strength, setStrength] = useState(0.8);
  const [reset, setReset] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const settings = useRef({ scene, paused, repel, strength });
  settings.current = { scene, paused, repel, strength };
  useEffect(() => {
    document.title = "Dex Playground";
    // Keep the reusable window's URL aligned with manual scene changes so a
    // later voice request can reliably switch it back to the requested scene.
    history.replaceState(null, "", `#playground?scene=${scene}`);
  }, [scene]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    let width = 1, height = 1, frame = 0, previous = 0, time = 0;
    let particles: Particle[] = [];
    const resize = () => {
      const rect = element.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const scale = Math.min(devicePixelRatio, 2);
      element.width = Math.round(width * scale); element.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      particles = Array.from({ length: 150 }, (_, i) => {
        const angle = Math.random() * Math.PI * 2, radius = (0.12 + Math.random() * 0.35) * Math.min(width, height);
        return { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius,
          vx: -Math.sin(angle) * 1.4, vy: Math.cos(angle) * 1.4, size: 1 + Math.random() * 1.8, hue: 35 + i % 35 };
      });
      ctx.fillStyle = "oklch(0.16 0.008 240)"; ctx.fillRect(0, 0, width, height);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const draw = (now: number) => {
      const dt = Math.min((now - (previous || now)) / 16.67, 2); previous = now;
      const { scene, paused, repel, strength } = settings.current;
      if (!paused) time += dt;
      ctx.fillStyle = scene === "orbit" && !paused ? "oklch(0.16 0.008 240 / 0.22)" : "oklch(0.16 0.008 240)";
      ctx.fillRect(0, 0, width, height);
      const target = pointer.current ?? { x: width / 2 + Math.sin(time / 180) * width * 0.08, y: height / 2 };
      for (const p of particles) {
        if (!paused) {
          const dx = target.x - p.x, dy = target.y - p.y, distance = Math.max(40, Math.hypot(dx, dy));
          const force = (repel ? -1 : 1) * strength * (scene === "orbit" ? 6 : 1.8) / distance;
          p.vx = (p.vx + dx / distance * force * dt) * 0.998;
          p.vy = (p.vy + dy / distance * force * dt) * 0.998;
          const speed = Math.hypot(p.vx, p.vy);
          if (speed > 4) { p.vx *= 4 / speed; p.vy *= 4 / speed; }
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x < 0 || p.x > width) { p.vx *= -1; p.x = Math.max(0, Math.min(width, p.x)); }
          if (p.y < 0 || p.y > height) { p.vy *= -1; p.y = Math.max(0, Math.min(height, p.y)); }
        }
        ctx.fillStyle = `oklch(0.82 0.10 ${p.hue})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      if (scene === "constellation") {
        for (let i = 0; i < particles.length; i++) for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j], distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 85) continue;
          ctx.strokeStyle = `oklch(0.78 0.06 70 / ${(1 - distance / 85) * 0.5})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      ctx.strokeStyle = "oklch(0.82 0.10 70 / 0.6)";
      ctx.beginPath(); ctx.arc(target.x, target.y, 10, 0, Math.PI * 2); ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [reset]);

  return <main className="flex h-screen flex-col bg-background text-foreground">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
      <div><p className="text-xs text-muted-foreground">DEX PLAYGROUND</p><h1 className="text-xl font-medium">{scene === "orbit" ? "A little gravity." : "Connect the dots."}</h1></div>
      <div className="flex gap-2" aria-label="Scene">
        {(["orbit", "constellation"] as const).map(value => <Button key={value} variant={scene === value ? "secondary" : "ghost"} aria-pressed={scene === value} onClick={() => { setScene(value); setReset(n => n + 1); }}>{value === "orbit" ? "Orbit" : "Constellation"}</Button>)}
      </div>
    </header>
    <div className="relative min-h-0 flex-1">
      <canvas ref={canvas} tabIndex={0} role="img" aria-label="Interactive particle field. Move the pointer to guide particles, or use arrow keys to move the gravity point. Space pauses."
        className="h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }; }}
        onPointerLeave={() => { pointer.current = null; }}
        onKeyDown={event => {
          if (event.key === " ") { event.preventDefault(); setPaused(value => !value); }
          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          const { width, height } = event.currentTarget.getBoundingClientRect();
          const p = pointer.current ?? { x: width / 2, y: height / 2 };
          pointer.current = { x: Math.max(0, Math.min(width, p.x + (event.key === "ArrowRight" ? 24 : event.key === "ArrowLeft" ? -24 : 0))), y: Math.max(0, Math.min(height, p.y + (event.key === "ArrowDown" ? 24 : event.key === "ArrowUp" ? -24 : 0))) };
        }} />
      <p className="pointer-events-none absolute bottom-4 left-6 text-xs text-muted-foreground">Move the pointer to guide the field. {paused ? "Paused." : "Live, right here on your computer."}</p>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setPaused(value => !value)}>{paused ? <Play /> : <Pause />}{paused ? "Play" : "Pause"}</Button>
        <Button variant="ghost" onClick={() => { pointer.current = null; setReset(value => value + 1); }}><RotateCcw />Reset</Button>
        <Button variant="secondary" aria-pressed={repel} onClick={() => setRepel(value => !value)}>{repel ? "Repel" : "Attract"}</Button>
      </div>
      <label className="flex items-center gap-3 text-xs text-muted-foreground">Gravity<input type="range" min="0" max="1.5" step="0.1" value={strength} onChange={event => setStrength(Number(event.target.value))} className="w-28" /></label>
    </footer>
  </main>;
}

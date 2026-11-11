import { useEffect, useRef } from "react";
import { sidPlayer } from "../lib/audio";

export function Waveform({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phase = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(139, 92, 246, 0.16)";
      ctx.lineWidth = 1;
      for (let y = 0; y < height; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }

      const analyser = sidPlayer.getAnalyser();
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#22d3ee");
      gradient.addColorStop(0.55, "#8b5cf6");
      gradient.addColorStop(1, "#f5c451");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.8;
      ctx.beginPath();

      if (analyser && playing) {
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        const step = Math.max(1, Math.floor(data.length / width));
        for (let x = 0; x < width; x += 1) {
          const v = data[Math.min(data.length - 1, x * step)] / 128 - 1;
          const y = height / 2 + v * (height / 2 - 3);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        phase.current += 0.05;
        for (let x = 0; x < width; x += 1) {
          const t = x / width;
          const y =
            height / 2 +
            Math.sin(t * 12 + phase.current) * 2.4 +
            Math.sin(t * 31 + phase.current * 1.7) * 1.1;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  return <canvas ref={canvasRef} className="h-12 w-full" />;
}

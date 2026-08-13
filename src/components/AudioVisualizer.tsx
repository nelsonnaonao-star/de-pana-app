import React, { useEffect, useRef } from "react";
import { logger } from "../lib/logger";

interface AudioVisualizerProps {
  audioUrl: string;
  playing: boolean;
  barCount?: number;
}

export function SoundBars({ count = 10 }: { count?: number }) {
  return (
    <div className="flex items-end justify-center w-full h-5 gap-[1px] overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`w-[3px] bg-gradient-to-t from-cyan-400 to-teal-300 rounded-sm animate-pulse`}
          style={{
            height: `${20 + (i % 4) * 8}px`,
            animationDelay: `${(i % 4) * 100}ms`,
            animationDuration: "1.2s",
          }}
        />
      ))}
    </div>
  );
}

export default function AudioVisualizer({ audioUrl, playing, barCount = 16 }: AudioVisualizerProps) {  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!playing || !audioUrl) return;

    const audio = new Audio(audioUrl);
    audio.loop = true;
    audio.preload = "auto";
    audioRef.current = audio;

    audio.play().catch(() => {});

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32;
    analyser.smoothing = 0.8;

    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);

    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      if (!ctx2d || !canvas || !playing) return;
      animationRef.current = requestAnimationFrame(draw);

      const { width: w, height: h } = canvas;
      ctx2d.clearRect(0, 0, w, h);

      analyser.getByteFrequencyData(dataArray);

      const barW = w / dataArray.length;
      const maxH = h * 0.9;
      const centerY = h * 0.5;

      dataArray.forEach((value, i) => {
        const barH = (value / 255) * maxH;
        ctx2d.fillStyle = i % 2 === 0 ? "#06b6d4" : "#10b981";
        ctx2d.fillRect(i * barW, centerY - barH, Math.max(barW - 1, 1), barH * 2);
      });
    };

    draw();

    return () => {
      animationRef.current && cancelAnimationFrame(animationRef.current);
      audio.pause();
      audio.src = "";
      try { ctx.close(); } catch (e) {
        logger.warn("[AudioVisualizer] AudioContext close failed", { error: e });
      }
    };
  }, [playing, audioUrl]);

  const bars = Array.from({ length: barCount }, (_, i) => (
    <div
      key={i}
      className="w-1 bg-gradient-to-t from-cyan-400 to-teal-300 rounded-full transition-all duration-100"
      style={{ height: 20 + (i % 3) * 10 }}
    />
  ));

  return (
    <div className="fixed bottom-0 left-0 right-0 flex items-end justify-center gap-[1px] h-12 pb-2 z-[100]">
      <canvas ref={canvasRef} width={128} height={40} className="absolute bottom-0 w-full h-12 opacity-0" />
      <div className="flex items-end justify-center w-full h-12 gap-[1px] overflow-hidden">
        {bars}
      </div>
    </div>
  );
}

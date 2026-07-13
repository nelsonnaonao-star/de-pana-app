import React, { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Mic, Loader2 } from "lucide-react";

const PLAY_EVENT = "audio-message-play";

let currentAudioId: string | null = null;

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface AudioMessagePlayerProps {
  audioUrl: string;
  msgId: string;
  isMe: boolean;
  isGlass?: boolean;
  duration?: string;
}

export default function AudioMessagePlayer({ audioUrl, msgId, isMe, isGlass = false, duration }: AudioMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [speed, setSpeed] = useState(1);
  const rangeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = audioUrl;
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      const metaDur = audio.duration;
      // Parse the expected duration from the "m:ss" prop as a fallback
      let expectedSec = 0;
      if (duration) {
        const parts = duration.split(":");
        if (parts.length === 2) expectedSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }
      // If metadata duration is suspiciously longer than expected (>50% more), cap it
      if (expectedSec > 0 && metaDur > expectedSec * 1.5) {
        setDurationSec(expectedSec);
      } else {
        setDurationSec(metaDur);
      }
      setIsLoading(false);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
      audio.playbackRate = 1;
      setSpeed(1);
      currentAudioId = null;
    };
    const onError = () => {
      setHasError(true);
      setIsLoading(false);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id !== msgId && audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    };
    window.addEventListener(PLAY_EVENT, handler);
    return () => window.removeEventListener(PLAY_EVENT, handler);
  }, [msgId]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    if (currentAudioId !== msgId) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: { id: msgId } }));
      currentAudioId = msgId;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isPlaying, msgId, hasError]);

  const onRangeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const val = parseFloat(e.target.value);
    audio.currentTime = val;
    setCurrentTime(val);
  }, []);

  const toggleSpeed = useCallback(() => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [speed]);

  const pct = durationSec > 0 ? (currentTime / durationSec) * 100 : 0;
  const displayDuration = durationSec > 0 ? durationSec : 0;

  if (hasError) {
    return (
      <div className="flex items-center gap-2 p-1 min-w-[180px]">
        <Mic className={`w-4 h-4 shrink-0 opacity-40 ${isGlass ? "text-gray-400" : ""}`} />
        <span className={`text-[10px] opacity-50 ${isGlass ? "text-gray-500" : ""}`}>Audio no disponible</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 w-full min-w-[190px] max-w-[260px]">
      <button
        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
        style={{
          background: isGlass
            ? "rgba(0,0,0,0.08)"
            : isMe
              ? "rgba(255,255,255,0.25)"
              : "rgba(0,0,0,0.08)",
          boxShadow: isPlaying
            ? "0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.15)"
            : "0 1px 3px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        {isLoading ? (
          <Loader2 className={`w-4 h-4 animate-spin ${isGlass ? "text-gray-500" : isMe ? "text-white" : "text-slate-500"}`} />
        ) : isPlaying ? (
          <Pause className={`w-4 h-4 ${isGlass ? "text-gray-800" : isMe ? "text-white" : "text-[#0a4d52]"}`} />
        ) : (
          <Play className={`w-4 h-4 ml-0.5 ${isGlass ? "text-gray-800" : isMe ? "text-white" : "text-[#0a4d52]"}`} />
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={durationSec || 0}
          step={0.1}
          value={currentTime}
          onChange={onRangeChange}
          onClick={(e) => e.stopPropagation()}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer audio-slider"
          style={{
            background: isGlass
              ? `linear-gradient(to right, rgba(0,0,0,0.55) ${pct}%, rgba(0,0,0,0.12) ${pct}%)`
              : isMe
                ? `linear-gradient(to right, rgba(255,255,255,0.95) ${pct}%, rgba(255,255,255,0.25) ${pct}%)`
                : `linear-gradient(to right, #0a4d52 ${pct}%, rgba(0,0,0,0.12) ${pct}%)`,
          }}
        />

        <div className="flex justify-between items-center">
          <span className={`text-[9px] font-mono ${isGlass ? "text-gray-600" : isMe ? "text-white/70" : "text-slate-400"}`}>
            {isPlaying ? formatTime(currentTime) : formatTime(displayDuration)}
          </span>
          <div className="flex items-center gap-1">
            {isPlaying && (
              <span className={`text-[9px] font-mono ${isGlass ? "text-gray-400" : isMe ? "text-white/50" : "text-slate-300"}`}>
                {formatTime(displayDuration)}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); toggleSpeed(); }}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-2 transition-colors ${
                isGlass
                  ? "bg-black/5 text-gray-600 hover:bg-black/10"
                  : isMe
                    ? "bg-white/15 text-white/80 hover:bg-white/25"
                    : "bg-black/10 text-slate-500 hover:bg-black/20"
              }`}
            >
              {speed}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

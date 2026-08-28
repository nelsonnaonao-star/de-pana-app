import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Loader2 } from "lucide-react";

const PLAY_EVENT = "audio-message-play";

let currentAudioId: string | null = null;

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ORB_SIZE = 60;
const RING_RADIUS = 26;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const INNER_RADIUS = 24;
const SEEK_BAND_START = 25;

const ORB_KEYFRAMES = `
  @keyframes orb-morph-1 {
    0%,100% { transform: translate(-5px,-3px) scale(1); }
    50% { transform: translate(5px,3px) scale(1.15); }
  }
  @keyframes orb-morph-2 {
    0%,100% { transform: translate(4px,-4px) scale(1.05); }
    50% { transform: translate(-4px,4px) scale(0.9); }
  }
  @keyframes orb-morph-3 {
    0%,100% { transform: translate(-3px,5px) scale(0.95); }
    50% { transform: translate(3px,-5px) scale(1.1); }
  }
`;

interface AudioMessagePlayerProps {
  audioUrl: string;
  msgId: string;
  isMe: boolean;
  isGlass?: boolean;
  duration?: string;
}

export default function AudioMessagePlayer({
  audioUrl,
  msgId,
  isMe,
  isGlass = false,
  duration,
}: AudioMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.src = audioUrl;
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      const metaDur = audio.duration;
      let expectedSec = 0;
      if (duration) {
        const parts = duration.split(":");
        if (parts.length === 2)
          expectedSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }
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
    const onError = (e: Event | string) => {
      console.warn("[AudioPlayer] error for", audioUrl, e);
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
      audio.play().then(() => setIsPlaying(true)).catch((err) => console.warn("[AudioPlayer] play() rejected:", err));
    }
  }, [isPlaying, msgId, hasError]);

  const onOrbClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const audio = audioRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);

      if (audio && durationSec > 0 && dist >= SEEK_BAND_START && dist <= ORB_SIZE) {
        const frac = ((((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360) + 360) % 360 / 360;
        const time = frac * durationSec;
        audio.currentTime = time;
        setCurrentTime(time);
        return;
      }

      togglePlay();
    },
    [durationSec, togglePlay]
  );

  const toggleSpeed = useCallback(() => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [speed]);

  const displayDuration = durationSec > 0 ? durationSec : 0;
  const progressFrac =
    durationSec > 0 && isFinite(durationSec)
      ? Math.min(1, Math.max(0, currentTime / durationSec))
      : 0;
  const dashoffset = RING_CIRCUMFERENCE - RING_CIRCUMFERENCE * progressFrac;

  const isDarkBubble = isMe;
  const ringTrackColor = isDarkBubble ? "rgba(255,255,255,0.2)" : "rgba(10,77,82,0.2)";
  const ringProgressColor = isDarkBubble ? "#ffffff" : "#0a4d52";
  const textColor = isDarkBubble ? "rgba(255,255,255,0.9)" : "#0a4d52";
  const speedColor = isDarkBubble ? "rgba(255,255,255,0.7)" : "#0a4d52";

  const blobBase = { position: "absolute" as const, borderRadius: "50%" };
  const blobAnimation = (name: string, secs: number) => ({
    animation: `${name} ${secs}s ease-in-out infinite`,
    animationPlayState: (isPlaying ? "running" : "paused") as "running" | "paused",
  });

  if (hasError) {
    return (
      <div className="flex items-center gap-2 p-1 min-w-[180px]">
        <Mic className={`w-4 h-4 shrink-0 opacity-40 ${isGlass ? "text-gray-400" : ""}`} />
        <span className={`text-[10px] opacity-50 ${isGlass ? "text-gray-500" : ""}`}>Audio no disponible</span>
      </div>
    );
  }

  return (
    <>
      <style>{ORB_KEYFRAMES}</style>
      <div
        className="flex items-center gap-3 w-fit"
        style={{
          background: "transparent",
          borderRadius: 20,
          padding: "4px 16px",
        }}
      >
        <div
          onClick={onOrbClick}
          role="button"
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
          className="relative shrink-0 select-none"
          style={{ width: ORB_SIZE, height: ORB_SIZE, minWidth: ORB_SIZE, cursor: "pointer" }}
        >
          <svg
            width={ORB_SIZE}
            height={ORB_SIZE}
            className="absolute inset-0"
            style={{ transform: "rotate(-90deg)" }}
            aria-hidden="true"
          >
            <circle
              cx={ORB_SIZE / 2}
              cy={ORB_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={ringTrackColor}
              strokeWidth="2"
            />
            <circle
              cx={ORB_SIZE / 2}
              cy={ORB_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={ringProgressColor}
              strokeWidth="2"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashoffset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 0.15s linear" }}
            />
          </svg>

          <div
            className="relative"
            style={{
              position: "absolute",
              inset: 6,
              borderRadius: "50%",
              overflow: "hidden",
              background: "#0A2E28",
            }}
          >
            <div
              style={{
                ...blobBase,
                ...blobAnimation("orb-morph-1", 3.2),
                width: 32,
                height: 32,
                left: 8,
                top: 8,
                background: "#5EB7FF",
                filter: "blur(9px)",
                opacity: 0.9,
              }}
            />
            <div
              style={{
                ...blobBase,
                ...blobAnimation("orb-morph-2", 2.6),
                width: 24,
                height: 24,
                left: 12,
                top: 12,
                background: "#C65EFF",
                filter: "blur(8px)",
                opacity: 0.8,
              }}
            />
            <div
              style={{
                ...blobBase,
                ...blobAnimation("orb-morph-3", 3.8),
                width: 20,
                height: 20,
                left: 14,
                top: 14,
                background: "#4ADE80",
                filter: "blur(7px)",
                opacity: 0.65,
              }}
            />
          </div>

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Loader2
                className="w-4 h-4 animate-spin"
                style={{ color: ringProgressColor, opacity: 0.6 }}
              />
            </div>
          )}
        </div>

        <span
          className="text-xs font-semibold tabular-nums shrink-0"
          style={{ color: textColor, fontWeight: 600 }}
        >
          {isPlaying || currentTime > 0 ? formatTime(currentTime) : formatTime(displayDuration)}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleSpeed();
          }}
          className="p-0 border-0 bg-transparent cursor-pointer shrink-0"
          style={{ color: speedColor, fontSize: 10, fontWeight: 700 }}
        >
          {speed}x
        </button>
      </div>
    </>
  );
}
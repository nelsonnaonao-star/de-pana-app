import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Loader2, RotateCw, Music, Play, Pause } from "lucide-react";
import BrandOrb from "../BrandOrb";

const PLAY_EVENT = "audio-message-play";

let currentAudioId: string | null = null;

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const DEFAULT_ORB_SIZE = 56;



interface AudioMessagePlayerProps {
  audioUrl: string;
  msgId: string;
  isMe: boolean;
  isGlass?: boolean;
  duration?: string;
  orbSize?: number;
  // "voice" = nota grabada (orbe WEPA). "track" = archivo de audio/música
  // enviado desde el adjunto, con tarjeta de pista y barra de progreso.
  variant?: "voice" | "track";
  fileName?: string;
  fileSize?: string;
}

export default function AudioMessagePlayer({
  audioUrl,
  msgId,
  isMe,
  isGlass = false,
  duration,
  orbSize = DEFAULT_ORB_SIZE,
  variant = "voice",
  fileName,
  fileSize,
}: AudioMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    // Nueva fuente (o reintento manual): el estado de error/loader debe partir
    // de cero. Antes quedaba pegado y un fallo transitorio dejaba el audio
    // muerto para siempre.
    setHasError(false);
    setIsLoading(true);
    setCurrentTime(0);
    setIsPlaying(false);

    if (!audioUrl) {
      setIsLoading(false);
      return;
    }

    const audio = new Audio();
    audio.preload = "metadata";
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
  }, [audioUrl, retryNonce]);

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
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.warn("[AudioPlayer] play() rejected:", err);
          // Formato/códec no soportado o fuente corrupta: ofrecer reintento en
          // vez de dejar el botón muerto sin explicación.
          if (err instanceof DOMException && err.name === "NotSupportedError") {
            setHasError(true);
          }
        });
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

      if (audio && durationSec > 0 && dist >= SEEK_BAND_START && dist <= orbSize) {
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

  const RING_RADIUS = orbSize / 2 - 4;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const SEEK_BAND_START = orbSize * (25 / 60);

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

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = frac * durationSec;
    setCurrentTime(audio.currentTime);
  };

  if (hasError) {
    return (
      <div className="flex items-center gap-2 p-1 min-w-[180px]">
        {variant === "track" ? (
          <Music className={`w-4 h-4 shrink-0 opacity-40 ${isGlass ? "text-gray-400" : ""}`} />
        ) : (
          <Mic className={`w-4 h-4 shrink-0 opacity-40 ${isGlass ? "text-gray-400" : ""}`} />
        )}
        <span className={`text-[10px] opacity-50 ${isGlass ? "text-gray-500" : ""}`}>Audio no disponible</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRetryNonce((n) => n + 1);
          }}
          className="ml-auto p-1 rounded-full border-0 bg-transparent cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: textColor }}
          title="Reintentar"
          aria-label="Reintentar audio"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (variant === "track") {
    const ext = fileName && fileName.includes(".") ? fileName.split(".").pop()?.toUpperCase() : "";
    const secondaryColor = isDarkBubble ? "rgba(255,255,255,0.65)" : "rgba(10,77,82,0.6)";
    return (
      <div
        className={`w-[248px] max-w-full rounded-xl p-2 ${isMe ? "bg-white/10" : isGlass ? "bg-black/5" : "bg-black/5 dark:bg-white/5"}`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isMe ? "bg-white/15 text-white" : "bg-teal-500/15 text-[#0a4d52]"}`}
          >
            <Music className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold truncate" style={{ color: textColor }}>
              {fileName || "Audio"}
            </p>
            <span className="text-[9px] font-mono truncate block" style={{ color: secondaryColor }}>
              {ext ? `${ext} • ` : ""}{fileSize ? `${fileSize} • ` : ""}{formatTime(displayDuration)}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-0 cursor-pointer transition-transform active:scale-95 ${isMe ? "bg-white text-[#0a4d52]" : "bg-[#0a4d52] text-white"}`}
            aria-label={isPlaying ? "Pausar" : "Reproducir"}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <span className="text-[9px] font-mono tabular-nums shrink-0" style={{ color: secondaryColor }}>
            {formatTime(currentTime)}
          </span>
          <div
            onClick={onSeek}
            className="relative flex-1 h-1.5 rounded-full cursor-pointer"
            style={{ background: ringTrackColor }}
            role="slider"
            aria-label="Progreso del audio"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressFrac * 100)}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${progressFrac * 100}%`, background: ringProgressColor }}
            />
          </div>
          <span className="text-[9px] font-mono tabular-nums shrink-0" style={{ color: secondaryColor }}>
            {formatTime(displayDuration)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSpeed();
            }}
            className="p-0 border-0 bg-transparent cursor-pointer shrink-0 text-[9px] font-bold"
            style={{ color: speedColor }}
          >
            {speed}x
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex items-center gap-2 w-fit"
        style={{
          background: "transparent",
          borderRadius: 20,
          padding: "2px 14px",
        }}
      >
        <div
          onClick={onOrbClick}
          role="button"
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
          className="relative shrink-0 select-none"
          style={{ width: orbSize, height: orbSize, minWidth: orbSize, cursor: "pointer" }}
        >
          <svg
            width={orbSize}
            height={orbSize}
            className="absolute inset-0"
            style={{ transform: "rotate(-90deg)" }}
            aria-hidden="true"
          >
            <circle
              cx={orbSize / 2}
              cy={orbSize / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={ringTrackColor}
              strokeWidth="2"
            />
            <circle
              cx={orbSize / 2}
              cy={orbSize / 2}
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
            style={{
              position: "absolute",
              inset: 6,
              borderRadius: "50%",
              overflow: "visible",
            }}
          >
            <BrandOrb size={orbSize - 12} animate={isPlaying} />
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
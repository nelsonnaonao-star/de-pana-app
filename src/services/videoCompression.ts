import fixWebmDuration from "fix-webm-duration";
import { logger } from "../lib/logger";

const MAX_DIMENSION = 720;
const TARGET_BITRATE = 2_000_000;
const AUDIO_BITRATE = 128_000;
const COMPRESS_TIMEOUT = 150_000;
const SKIP_THRESHOLD = 5 * 1024 * 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 180;

function detectVideoMimeType(): string {
  const candidates = [
    "video/webm;codecs=h264",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.playsInline = true;
    v.muted = false;
    v.src = url;
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("Error loading video"));
    setTimeout(() => reject(new Error("Timeout loading video")), 15000);
  });
}

function getTargetDimensions(vw: number, vh: number): [number, number] {
  let w = vw;
  let h = vh;
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  if (w % 2 !== 0) w++;
  if (h % 2 !== 0) h++;
  return [w, h];
}

export async function compressVideo(file: File): Promise<Blob> {
  if (file.size < SKIP_THRESHOLD) return file;
  if (file.size > MAX_FILE_SIZE) throw new Error("El video es demasiado grande (>100MB)");

  const canCaptureStream = typeof HTMLCanvasElement.prototype.captureStream !== "undefined";
  if (!canCaptureStream) throw new Error("captureStream not supported");

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Compression timed out")), COMPRESS_TIMEOUT)
  );

  const compressed = await Promise.race([doCompress(file), timeout]);

  if (compressed.size >= file.size) return file;

  return compressed;
}

async function doCompress(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);

  const video = await loadVideo(url);

  if (video.duration > MAX_DURATION_SECONDS) {
    URL.revokeObjectURL(url);
    video.remove();
    throw new Error(`Video muy largo (${Math.round(video.duration)}s). Máx ${MAX_DURATION_SECONDS}s`);
  }

  const durationMs = Math.round(video.duration * 1000);
  const [targetW, targetH] = getTargetDimensions(video.videoWidth, video.videoHeight);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  canvas.style.display = "none";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;

  video.currentTime = 0;
  await video.play();

  let audioTrack: MediaStreamTrack | null = null;
  let audioCtx: AudioContext | null = null;

  try {
    const fullStream = (video as any).captureStream?.();
    if (fullStream) {
      audioTrack = fullStream.getAudioTracks()[0] || null;
    }
  } catch (e) {
    logger.warn("[VideoCompression] captureStream failed", { error: e });
  }

  if (!audioTrack) {
    try {
      audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const source = audioCtx.createMediaElementSource(video);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      audioTrack = dest.stream.getAudioTracks()[0] || null;
    } catch (e) {
      logger.warn("[VideoCompression] AudioContext fallback failed", { error: e });
    }
  }

  const canvasStream = canvas.captureStream(30);
  const videoTrack = canvasStream.getVideoTracks()[0];

  const tracks: MediaStreamTrack[] = [videoTrack];
  if (audioTrack) tracks.push(audioTrack);
  const combinedStream = new MediaStream(tracks);

  const mimeType = detectVideoMimeType();

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: TARGET_BITRATE,
    audioBitsPerSecond: AUDIO_BITRATE,
  });

  const recordingDone = new Promise<void>((resolve) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve();
  });

  recorder.start(1000);

  await new Promise<void>((resolve) => {
    const render = () => {
      try { ctx.drawImage(video, 0, 0, targetW, targetH); } catch (e) {
        logger.warn("[VideoCompression] drawImage failed", { error: e });
      }
      if (!video.ended && !video.paused) {
        requestAnimationFrame(render);
      } else {
        resolve();
      }
    };
    video.addEventListener("ended", () => resolve());
    render();
  });

  recorder.stop();
  await recordingDone;

  URL.revokeObjectURL(url);
  video.remove();
  canvas.remove();
  audioCtx?.close();

  const raw = new Blob(chunks, { type: mimeType });

  if (raw.size <= 0) throw new Error("Compressed blob is empty");

  if (mimeType.startsWith("video/webm")) {
    try {
      const fixed = await fixWebmDuration(raw, durationMs);
      return fixed;
    } catch (e) {
      throw new Error(`Duration fix failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return raw;
}

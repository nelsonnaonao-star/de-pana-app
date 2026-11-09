package com.redon.app.plugins;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.annotation.Nullable;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Compresión de video por hardware con Media3 Transformer.
 *
 * Sustituye la recompresión en tiempo real del WebView (MediaRecorder) por el
 * encoder H.264 del dispositivo (MediaCodec), que es entre 5 y 20 veces más
 * rápido. Acepta URIs nativos (file:// o content://) y devuelve otro URI nativo
 * en la caché de la app para que JS lo pueda subir o reproducir.
 */
@UnstableApi
@CapacitorPlugin(name = "VideoCompressor")
public class VideoCompressorPlugin extends Plugin {

    private static final String TAG = "VideoCompressor";
    private static final int MIN_SHORT_SIDE = 144;
    private static final int MAX_SHORT_SIDE = 1080;
    private static final int DEFAULT_SHORT_SIDE = 720;
    private static final int DEFAULT_BITRATE = 2_000_000;
    private static final int MIN_BITRATE = 200_000;
    private static final int MAX_BITRATE = 12_000_000;
    private static final long PROGRESS_INTERVAL_MS = 400L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Nullable
    private Job activeJob;

    private static final class Job {
        final PluginCall call;
        final File output;
        final AtomicBoolean settled = new AtomicBoolean(false);

        @Nullable
        Transformer transformer;

        @Nullable
        File copiedInput;

        Job(PluginCall call, File output) {
            this.call = call;
            this.output = output;
        }

        boolean settle() {
            return settled.compareAndSet(false, true);
        }
    }

    @PluginMethod
    public void compress(PluginCall call) {
        String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.trim().isEmpty()) {
            call.reject("Falta el uri del video", "INVALID_ARGUMENT");
            return;
        }
        int targetShortSide = clamp(
            call.getInt("height", DEFAULT_SHORT_SIDE), MIN_SHORT_SIDE, MAX_SHORT_SIDE);
        int requestedBitrate = clamp(
            call.getInt("bitrate", DEFAULT_BITRATE), MIN_BITRATE, MAX_BITRATE);
        String uri = rawUri.trim();

        mainHandler.post(() -> startJob(call, uri, targetShortSide, requestedBitrate));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        mainHandler.post(() -> {
            cancelActiveJob("Compresión cancelada");
            if (!call.isReleased()) call.resolve();
        });
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("Falta el path del archivo", "INVALID_ARGUMENT");
            return;
        }
        String target = path.trim();

        mainHandler.post(() -> {
            try {
                if (deleteIfInCache(target)) {
                    Log.d(TAG, "delete ok path=" + target);
                }
                if (!call.isReleased()) call.resolve();
            } catch (Exception e) {
                if (!call.isReleased()) {
                    call.reject("No se pudo borrar el archivo: " + e.getMessage(), "DELETE_FAILED");
                }
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.post(() -> cancelActiveJob("Plugin destruido"));
        super.handleOnDestroy();
    }

    private void startJob(PluginCall call, String rawUri, int targetShortSide, int requestedBitrate) {
        cancelActiveJob("Compresión reemplazada por una nueva solicitud");

        Context context = getContext();
        File output = new File(
            context.getCacheDir(),
            "wepa_video_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12) + ".mp4"
        );
        Job job = new Job(call, output);

        try {
            Uri inputUri = normalizeUri(rawUri);
            if ("content".equals(inputUri.getScheme())) {
                job.copiedInput = copyToCache(context, inputUri);
                inputUri = Uri.fromFile(job.copiedInput);
            }

            int sourceShortSide = readShortSide(context, inputUri);
            int effectiveBitrate = requestedBitrate;
            if (sourceShortSide > 0 && sourceShortSide < targetShortSide) {
                // No tiene sentido gastar más bits que el original: se limita el
                // bitrate para no agrandar videos pequeños al recomprimirlos.
                effectiveBitrate = Math.min(
                    requestedBitrate,
                    Math.max(400_000, sourceShortSide * 2_200)
                );
            }

            List<Effect> videoEffects =
                sourceShortSide <= 0 || sourceShortSide > targetShortSide
                    ? Collections.<Effect>singletonList(Presentation.createForShortSide(targetShortSide))
                    : Collections.<Effect>emptyList();

            EditedMediaItem editedMediaItem = new EditedMediaItem.Builder(MediaItem.fromUri(inputUri))
                .setEffects(new Effects(Collections.emptyList(), videoEffects))
                .build();

            DefaultEncoderFactory encoderFactory = new DefaultEncoderFactory.Builder(context)
                .setRequestedVideoEncoderSettings(
                    new VideoEncoderSettings.Builder().setBitrate(effectiveBitrate).build())
                .build();

            Transformer transformer = new Transformer.Builder(context)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(encoderFactory)
                .addListener(new Transformer.Listener() {
                    @Override
                    public void onCompleted(Composition composition, ExportResult exportResult) {
                        mainHandler.post(() -> handleCompleted(job, exportResult));
                    }

                    @Override
                    public void onError(
                        Composition composition,
                        ExportResult exportResult,
                        ExportException exportException
                    ) {
                        mainHandler.post(() -> handleError(job, exportException));
                    }
                })
                .build();

            job.transformer = transformer;
            activeJob = job;

            Log.d(
                TAG,
                "start uri=" + inputUri +
                    " targetShortSide=" + targetShortSide +
                    " sourceShortSide=" + sourceShortSide +
                    " bitrate=" + effectiveBitrate +
                    " output=" + output.getAbsolutePath()
            );

            beginProgress(job);
            transformer.start(editedMediaItem, output.getAbsolutePath());
        } catch (Throwable t) {
            Log.e(TAG, "No se pudo iniciar la compresión", t);
            fail(job, "No se pudo iniciar la compresión: " + t.getMessage(), "COMPRESS_FAILED");
        }
    }

    private void beginProgress(Job job) {
        ProgressHolder holder = new ProgressHolder();
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (activeJob != job || job.settled.get() || job.transformer == null) return;
                int state = job.transformer.getProgress(holder);
                if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
                    JSObject data = new JSObject();
                    data.put("progress", holder.progress);
                    notifyListeners("progress", data);
                }
                mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS);
            }
        });
    }

    private void handleCompleted(Job job, @Nullable ExportResult result) {
        if (!job.settle()) return;
        if (activeJob == job) activeJob = null;

        if (!job.output.exists() || job.output.length() <= 0) {
            job.output.delete();
            cleanup(job);
            if (!job.call.isReleased()) {
                job.call.reject("La compresión no generó un archivo válido", "COMPRESS_FAILED");
            }
            return;
        }

        int width = result != null ? result.width : 0;
        int height = result != null ? result.height : 0;
        long durationMs = result != null ? result.durationMs : 0L;

        JSObject out = new JSObject();
        out.put("uri", Uri.fromFile(job.output).toString());
        out.put("path", job.output.getAbsolutePath());
        out.put("size", job.output.length());
        out.put("width", width);
        out.put("height", height);
        out.put("durationMs", durationMs);
        out.put("duration", durationMs / 1000.0);
        out.put("mimeType", "video/mp4");
        out.put("cancelled", false);

        Log.d(
            TAG,
            "done size=" + job.output.length() +
                " " + width + "x" + height +
                " durationMs=" + durationMs
        );

        cleanup(job);
        if (!job.call.isReleased()) job.call.resolve(out);
    }

    private void handleError(Job job, @Nullable ExportException error) {
        if (!job.settle()) return;
        if (activeJob == job) activeJob = null;

        job.output.delete();
        cleanup(job);

        String codeName = error != null ? error.getErrorCodeName() : "UNKNOWN";
        Log.e(TAG, "compress error " + codeName, error);
        if (!job.call.isReleased()) {
            job.call.reject("No se pudo comprimir el video (" + codeName + ")", "COMPRESS_FAILED");
        }
    }

    private void fail(Job job, String message, String code) {
        if (!job.settle()) return;
        if (activeJob == job) activeJob = null;

        if (job.transformer != null) {
            try {
                job.transformer.cancel();
            } catch (Exception ignored) {
                // El transformer ya pudo haber terminado.
            }
        }
        job.output.delete();
        cleanup(job);

        if (!job.call.isReleased()) job.call.reject(message, code);
    }

    private void cancelActiveJob(String message) {
        Job job = activeJob;
        if (job == null) return;
        activeJob = null;

        boolean firstSettle = job.settle();
        if (job.transformer != null) {
            try {
                job.transformer.cancel();
            } catch (Exception ignored) {
                // Cancelar es best-effort.
            }
        }
        job.output.delete();
        cleanup(job);

        if (firstSettle && !job.call.isReleased()) {
            job.call.reject(message, "CANCELLED");
        }
    }

    private void cleanup(Job job) {
        job.transformer = null;
        if (job.copiedInput != null) {
            job.copiedInput.delete();
            job.copiedInput = null;
        }
    }

    private boolean deleteIfInCache(String path) throws Exception {
        String candidate = path;
        if (candidate.startsWith("file://")) {
            candidate = Uri.parse(candidate).getPath();
        }
        if (candidate == null || candidate.isEmpty()) return false;

        File cacheDir = getContext().getCacheDir().getCanonicalFile();
        File file = new File(candidate).getCanonicalFile();
        String cachePrefix = cacheDir.getAbsolutePath() + File.separator;
        if (!file.getAbsolutePath().startsWith(cachePrefix)) return false;
        return !file.exists() || file.delete();
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static Uri normalizeUri(String raw) {
        String value = raw.trim();
        if (value.startsWith("content://") || value.startsWith("file://")) {
            return Uri.parse(value);
        }
        if (value.startsWith("/")) {
            return Uri.fromFile(new File(value));
        }
        return Uri.parse(value);
    }

    private File copyToCache(Context context, Uri uri) throws Exception {
        String mime = context.getContentResolver().getType(uri);
        String extension = mime != null
            ? MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
            : null;
        if (extension == null) extension = "mp4";

        File target = new File(
            context.getCacheDir(),
            "wepa_input_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12) +
                "." + extension
        );

        try (InputStream in = context.getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new IllegalStateException("No se pudo abrir el video de origen");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
            out.flush();
        }
        return target;
    }

    private static int readShortSide(Context context, Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context, uri);
            String widthValue = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String heightValue = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            if (widthValue == null || heightValue == null) return 0;
            int width = Integer.parseInt(widthValue);
            int height = Integer.parseInt(heightValue);
            if (width <= 0 || height <= 0) return 0;
            return Math.min(width, height);
        } catch (Throwable t) {
            Log.w(TAG, "No se pudo leer la resolución de origen", t);
            return 0;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
                // Retriever ya liberado.
            }
        }
    }
}

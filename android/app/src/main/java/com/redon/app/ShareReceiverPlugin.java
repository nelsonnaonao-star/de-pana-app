package com.redon.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Recibe imágenes compartidas desde el menú "Compartir" de Android.
 *
 * Flujo:
 *  1. MainActivity recibe ACTION_SEND / ACTION_SEND_MULTIPLE.
 *  2. MainActivity llama a ShareReceiverPlugin.deliver(context, uris).
 *  3. El plugin copia cada content:// a cache/shared/ (el WebView no lee
 *     content:// directamente).
 *  4. Persiste las rutas en SharedPreferences (arranque en frío) y notifica
 *     a JS el evento "shareReceived" con { paths: string[] }.
 *  5. JS también puede llamar a getPendingShare() al montar para consumir
 *     las rutas pendientes.
 *
 * Seguridad:
 *  - Copia inmediata mientras el permiso temporal del intent está vigente.
 *  - Nombre generado por la app; nunca se usa el nombre original.
 *  - Extensión derivada del MIME y saneada.
 *  - Límite de 50 MB por archivo.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    private static final String TAG = "ShareReceiver";
    private static final String PREFS = "CapacitorStorage";
    private static final String PENDING_KEY = "redon_pending_share";
    private static final long MAX_BYTES = 50L * 1024L * 1024L;

    private static ShareReceiverPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** Devuelve y limpia las rutas pendientes (respaldo de arranque en frío). */
    @PluginMethod
    public void getPendingShare(PluginCall call) {
        List<String> paths = readAndClearPending(getContext());
        JSObject result = new JSObject();
        result.put("paths", new JSArray(paths));
        call.resolve(result);
    }

    /** Llamado desde MainActivity con los URIs del intent. */
    public static void deliver(Context context, List<Uri> uris) {
        List<String> paths = new ArrayList<>();
        for (Uri uri : uris) {
            String path = copyToCache(context, uri);
            if (path != null) paths.add(path);
        }
        if (paths.isEmpty()) return;

        persistPending(context, paths);

        ShareReceiverPlugin plugin = instance;
        if (plugin == null || plugin.getActivity() == null) return;

        JSObject data = new JSObject();
        data.put("paths", new JSArray(paths));
        plugin.getActivity().runOnUiThread(() -> {
            try {
                plugin.notifyListeners("shareReceived", data, true);
            } catch (Exception e) {
                Log.e(TAG, "No se pudo notificar a JS", e);
            }
        });
    }

    private static String copyToCache(Context context, Uri uri) {
        if (uri == null) return null;

        InputStream in = null;
        FileOutputStream out = null;
        try {
            String mime = context.getContentResolver().getType(uri);
            String ext = extensionForMime(mime);

            File dir = new File(context.getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) return null;
            cleanupOldFiles(dir);

            File file = new File(dir, "share-" + System.currentTimeMillis() + "-" + UUID.randomUUID() + "." + ext);
            in = context.getContentResolver().openInputStream(uri);
            if (in == null) return null;

            out = new FileOutputStream(file);
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) {
                    throw new IOException("Imagen compartida demasiado grande");
                }
                out.write(buffer, 0, read);
            }
            out.flush();
            return file.getAbsolutePath();
        } catch (Exception e) {
            Log.e(TAG, "No se pudo copiar la imagen compartida", e);
            return null;
        } finally {
            try {
                if (in != null) in.close();
            } catch (Exception ignored) {}
            try {
                if (out != null) out.close();
            } catch (Exception ignored) {}
        }
    }

    private static String extensionForMime(String mime) {
        if (mime != null) {
            switch (mime) {
                case "image/jpeg": return "jpg";
                case "image/png": return "png";
                case "image/webp": return "webp";
                case "image/gif": return "gif";
                case "image/heic": return "heic";
                case "image/heif": return "heif";
                default: break;
            }
            String fromMap = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (fromMap != null && fromMap.matches("[a-zA-Z0-9]{1,8}")) {
                return fromMap.toLowerCase();
            }
        }
        return "bin";
    }

    private static void cleanupOldFiles(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < cutoff) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

    private static void persistPending(Context context, List<String> paths) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray current;
            try {
                current = new JSONArray(prefs.getString(PENDING_KEY, "[]"));
            } catch (Exception e) {
                current = new JSONArray();
            }
            for (String path : paths) {
                boolean exists = false;
                for (int i = 0; i < current.length(); i++) {
                    if (path.equals(current.optString(i))) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) current.put(path);
            }
            prefs.edit().putString(PENDING_KEY, current.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "No se pudo persistir el share pendiente", e);
        }
    }

    private static List<String> readAndClearPending(Context context) {
        List<String> result = new ArrayList<>();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(prefs.getString(PENDING_KEY, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                String path = arr.optString(i, null);
                if (path != null && !path.isEmpty()) result.add(path);
            }
            prefs.edit().remove(PENDING_KEY).apply();
        } catch (Exception e) {
            Log.e(TAG, "No se pudo leer el share pendiente", e);
        }
        return result;
    }
}

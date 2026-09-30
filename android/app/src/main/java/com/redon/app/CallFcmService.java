package com.redon.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.core.app.RemoteInput;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Shader;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class CallFcmService extends FirebaseMessagingService {

    private static final String TAG = "CallFcmService";
    private static final String CHANNEL_CALLS = "redon-calls";
    private static final String CHANNEL_MESSAGES = "redon-messages";
    private static final String CHANNEL_GROUPS = "redon-groups-v2";
    private static final String REPLY_ACTION = "com.redon.app.REPLY_MESSAGE";
    private static final String PENDING_MESSAGE_KEY = "redon_pending_message";

    // Almacenamiento compartido creado por el plugin @capacitor/preferences
    private static final String SOUND_PREFS = "CapacitorStorage";
    private static final String PREF_MSG_SOUND = "redon_sound_message";
    private static final String PREF_CALL_SOUND = "redon_sound_call";

    private String getSoundPref(String key, String def) {
        try {
            SharedPreferences prefs = getSharedPreferences(SOUND_PREFS, Context.MODE_PRIVATE);
            String value = prefs.getString(key, null);
            return (value != null && !value.isEmpty()) ? value : def;
        } catch (Exception e) {
            return def;
        }
    }

    // Devuelve el nombre del recurso raw que corresponde al id de sonido seleccionado.
    private String rawNameFor(String event, String soundId) {
        if ("message".equals(event)) {
            if ("noti1".equals(soundId)) return "noti1";
            if ("noti2".equals(soundId)) return "noti2";
            if ("noti3".equals(soundId)) return "noti3";
            if ("noti4".equals(soundId)) return "noti4";
            if ("noti5".equals(soundId)) return "noti5";
            if ("noti6".equals(soundId)) return "noti6";
            return "notificacion";
        }
        // llamada: ring1 -> ringtone, ring2 -> ring1, ring3 -> ring2
        if ("ring2".equals(soundId)) return "ring1";
        if ("ring3".equals(soundId)) return "ring2";
        return "ringtone";
    }

    private String callChannelId(String soundId) {
        if ("ring2".equals(soundId)) return CHANNEL_CALLS + "-ring2";
        if ("ring3".equals(soundId)) return CHANNEL_CALLS + "-ring3";
        return CHANNEL_CALLS;
    }

    private String messageChannelId(String soundId) {
        if ("noti1".equals(soundId)) return CHANNEL_MESSAGES + "-noti1";
        if ("noti2".equals(soundId)) return CHANNEL_MESSAGES + "-noti2";
        if ("noti3".equals(soundId)) return CHANNEL_MESSAGES + "-noti3";
        if ("noti4".equals(soundId)) return CHANNEL_MESSAGES + "-noti4";
        if ("noti5".equals(soundId)) return CHANNEL_MESSAGES + "-noti5";
        if ("noti6".equals(soundId)) return CHANNEL_MESSAGES + "-noti6";
        return CHANNEL_MESSAGES;
    }

    private void ensureChannel(String channelId, String name, String rawName, long[] vibration, String desc) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nmgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nmgr == null) return;
            // Forzar recreación para aplicar siempre el sonido actual del canal solicitado
            // (Android 8+ ignora setSound() sobre un canal ya creado).
            nmgr.deleteNotificationChannel(channelId);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).build();
            NotificationChannel chan = new NotificationChannel(
                channelId, name, NotificationManager.IMPORTANCE_HIGH
            );
            chan.setDescription(desc);
            chan.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/raw/" + rawName), audioAttrs
            );
            chan.enableVibration(true);
            chan.setVibrationPattern(vibration);
            chan.enableLights(true);
            chan.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            chan.setShowBadge(true);
            nmgr.createNotificationChannel(chan);
        } catch (Exception e) {
            Log.e(TAG, "Failed to create channel " + channelId, e);
        }
    }

    private String resolveMessageChannel() {
        String soundId = getSoundPref(PREF_MSG_SOUND, "clasica");
        String channelId = messageChannelId(soundId);
        ensureChannel(channelId, "Mensajes", rawNameFor("message", soundId),
            new long[]{0, 300, 200, 300}, "Notificaciones de mensajes");
        return channelId;
    }

    private String resolveCallChannel() {
        String soundId = getSoundPref(PREF_CALL_SOUND, "ring1");
        String channelId = callChannelId(soundId);
        ensureChannel(channelId, "Llamadas", rawNameFor("call", soundId),
            new long[]{0, 500, 300, 500, 300, 500}, "Notificaciones de llamadas entrantes");
        return channelId;
    }

    // Canal fijo para eventos de GRUPO (agregado al grupo / mensajes dentro de grupo).
    // Usa siempre el asset group_created.mp3 para distinguirse del sonido 1:1.
    private String resolveGroupChannel() {
        ensureChannel(CHANNEL_GROUPS, "Grupos", "group_created",
            new long[]{0, 300, 200, 300}, "Notificaciones de grupos");
        return CHANNEL_GROUPS;
    }

    // Es un evento de grupo si el push lo marca explícitamente (is_group) o si el
    // tipo es group_added (inherentemente grupal).
    private boolean isGroupNotification(RemoteMessage message) {
        if ("group_added".equals(message.getData().get("type"))) return true;
        return "true".equals(message.getData().get("is_group"));
    }

    // Decisión única de sonido para notificaciones no-call: 1:1 usa el canal de
    // mensajes normal (preferencia del usuario), grupo usa el canal redon-groups.
    private String channelFor(RemoteMessage message) {
        String channelId = isGroupNotification(message) ? resolveGroupChannel() : resolveMessageChannel();
        Log.d(TAG, "channelFor -> " + channelId + " (type=" + message.getData().get("type") + ", is_group=" + message.getData().get("is_group") + ")");
        return channelId;
    }

    // Payload del mensaje recibido en background para que JS lo recupere al volver
    // al foreground (abierta por el ícono, SIN tocar la notificación). Mismo
    // mecanismo que MainActivity.persistPendingCall: SharedPreferences
    // "CapacitorStorage", leída por @capacitor/preferences desde el WebView.
    private void persistPendingMessage(RemoteMessage message) {
        try {
            SharedPreferences prefs = getSharedPreferences(SOUND_PREFS, Context.MODE_PRIVATE);
            String chatId = message.getData().get("chatId");
            String contactId = message.getData().get("contactId");
            if (chatId == null || chatId.isEmpty()) return;
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("chatId", chatId);
            payload.put("contactId", contactId != null ? contactId : "");
            payload.put("title", message.getData().get("title"));
            payload.put("body", message.getData().get("body"));
            payload.put("is_group", message.getData().get("is_group"));
            payload.put("ts", message.getData().get("ts"));
            prefs.edit().putString(PENDING_MESSAGE_KEY, payload.toString()).apply();
            Log.d(TAG, "Persisted pending message for chat " + chatId);
        } catch (Exception e) {
            Log.e(TAG, "Failed to persist pending message", e);
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "New FCM token: " + token);
        try {
            PushNotificationsPlugin.onNewToken(token);
        } catch (Exception e) {
            Log.e(TAG, "Failed to bridge token to Capacitor JS", e);
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Log.d(TAG, "onMessageReceived: " + message.getData());

        String type = message.getData().get("type");

        // El push "call_dismissed" avisa que una llamada terminó (ringing -> ended/missed).
        // NO es un mensaje: no debe renderizarse como notificación de "Nuevo mensaje".
        if ("call_dismissed".equals(type)) {
            Log.d(TAG, "call_dismissed — cancelling call notification, no message shown");
            String chatId = message.getData().get("chatId");
            if (chatId != null) {
                int notificationId = ("call-" + chatId).hashCode();
                NotificationManager nmgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nmgr != null) nmgr.cancel(notificationId);
            }
            try {
                PushNotificationsPlugin.sendRemoteMessage(message);
            } catch (Exception e) {
                Log.e(TAG, "Failed to bridge call_dismissed to Capacitor JS", e);
            }
            return;
        }

        if (isAppInForeground()) {
            // App is visible: bridge to JS only — native notification would duplicate the in-app CallOverlay
            if ("call".equals(type)) {
                try {
                    PushNotificationsPlugin.sendRemoteMessage(message);
                    Log.d(TAG, "Bridged to Capacitor JS via PushNotificationsPlugin.onMessageReceived");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to bridge to Capacitor JS", e);
                }
            } else {
                // Bridge message pushes to JS (unread/preview + persistencia ligera en SQLite).
                // La notificación visual sigue siendo SOLO la nativa de abajo: el JS no muestra ninguna.
                try {
                    PushNotificationsPlugin.sendRemoteMessage(message);
                    Log.d(TAG, "Bridged message to Capacitor JS");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to bridge message to Capacitor JS", e);
                }
                showForegroundMessageNotification(message);
            }
        } else {
            // App is in background: show native notification with full-screen intent
            if ("call".equals(type)) {
                showCallNotification(message);
            } else {
                // Bridge message pushes to JS antes de la notificación nativa: el JS
                // procesa el dato (persistencia SQLite) pero NO muestra nada visual.
                try {
                    PushNotificationsPlugin.sendRemoteMessage(message);
                    Log.d(TAG, "Bridged message to Capacitor JS (background)");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to bridge message to Capacitor JS", e);
                }
                // Persistir el payload: si el usuario abre la app por el ícono (no por
                // la notificación), JS lo recupera al volver a foreground y procesa el
                // mensaje sin esperar a que Realtime reconecte.
                persistPendingMessage(message);
                showMessageNotification(message);
            }
        }
    }

    private boolean isAppInForeground() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        List<ActivityManager.RunningAppProcessInfo> processes = am.getRunningAppProcesses();
        if (processes == null) return false;
        for (ActivityManager.RunningAppProcessInfo p : processes) {
            if (getPackageName().equals(p.processName)) {
                return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    || p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
            }
        }
        return false;
    }

    private void showIncomingCallActivity(RemoteMessage message) {
        String chatId = message.getData().get("chatId");
        String callerId = message.getData().get("callerId");
        String callerName = message.getData().get("callerName");
        String callType = message.getData().get("callType");
        if (callType == null) callType = "audio";
        if (callerName == null) callerName = "Llamada entrante";

        int notificationId = ("call-" + (chatId != null ? chatId : "")).hashCode();

        Intent intent = new Intent(this, IncomingCallActivity.class);
        intent.putExtra("chatId", chatId);
        intent.putExtra("callerId", callerId);
        intent.putExtra("callerName", callerName);
        intent.putExtra("callType", callType);
        intent.putExtra("notificationId", notificationId);
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );

        Log.d(TAG, "Launching IncomingCallActivity for: " + callerName);
        startActivity(intent);
    }

    private void showCallNotification(RemoteMessage message) {
        String title = message.getData().get("title");
        String body = message.getData().get("body");
        String chatId = message.getData().get("chatId");
        String callerId = message.getData().get("callerId");
        String callerName = message.getData().get("callerName");
        String callType = message.getData().get("callType");

        if (title == null) title = callerName != null ? callerName : "RED ON";
        if (body == null) body = "Llamada entrante";
        if (callType == null) callType = "audio";

        int notificationId = ("call-" + (chatId != null ? chatId : "")).hashCode();

        String callChannel = resolveCallChannel();

        Intent answerIntent = new Intent(this, MainActivity.class);
        answerIntent.setAction("ANSWER_CALL");
        answerIntent.putExtra("chatId", chatId);
        answerIntent.putExtra("callerId", callerId);
        answerIntent.putExtra("callerName", callerName);
        answerIntent.putExtra("callType", callType);
        answerIntent.putExtra("type", "call");
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent answerPending = PendingIntent.getActivity(
            this, notificationId, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent declineIntent = new Intent(this, CallActionReceiver.class);
        declineIntent.setAction("DECLINE_CALL");
        declineIntent.putExtra("notificationId", notificationId);
        declineIntent.putExtra("callerId", callerId);
        declineIntent.putExtra("callerName", callerName);
        PendingIntent declinePending = PendingIntent.getBroadcast(
            this, notificationId + 1, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/ringtone");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, callChannel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(answerPending)
            .setFullScreenIntent(answerPending, true)
            .setVibrate(new long[]{0, 500, 300, 500, 300, 500})
            .setDefaults(NotificationCompat.DEFAULT_LIGHTS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(Color.parseColor("#E53935"))
            .addAction(android.R.drawable.ic_menu_call, "Responder", answerPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Rechazar", declinePending);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
        }
    }

    private static final int AVATAR_LOAD_TIMEOUT_MS = 3000;
    private static final int AVATAR_MAX_BYTES = 1048576;

    // Replica exacta de hashUrl() de src/components/CachedImage.tsx para reutilizar
    // el MISMO caché de la webview: getFilesDir()/image_cache/<hash>.<ext>.
    private static String hashUrl(String url) {
        int hash = 0;
        for (int i = 0; i < url.length(); i++) {
            hash = hash * 31 + url.charAt(i);
        }
        long abs = hash < 0 ? -(long) hash : (long) hash;
        return Long.toString(abs, 36);
    }

    // Replica de getExtension() de CachedImage.tsx (mismo resultado por URL).
    private static String avatarExtension(String url) {
        Matcher m = Pattern.compile("\\.(\\w{3,4})(\\?|$)").matcher(url);
        if (m.find()) return m.group(1).toLowerCase();
        if (url.contains("gif")) return "gif";
        if (url.contains("webp")) return "webp";
        if (url.contains("png")) return "png";
        return "jpg";
    }

    private static String avatarCacheFileName(String url) {
        return hashUrl(url) + "." + avatarExtension(url);
    }

    // Carga el avatar del remitente en un worker: primero el caché compartido
    // image_cache/ (mismo archivo que escribe CachedImage.tsx) y, si no existe,
    // descarga con timeout corto y lo guarda con el mismo naming. Con cualquier
    // problema (timeout, HTTP, stream, bitmap inválido, archivo corrupto) devuelve
    // null: la foto es OPCIONAL y jamás debe impedir la notificación.
    private static Bitmap loadAvatarBitmap(String cacheDir, String avatarUrl) {
        File dir = new File(cacheDir);
        if (!dir.exists()) dir.mkdirs();
        File file = new File(dir, avatarCacheFileName(avatarUrl));
        if (file.exists()) {
            Bitmap cached = BitmapFactory.decodeFile(file.getAbsolutePath());
            if (cached != null) return cached;
        }
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            URL url = new URL(avatarUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(AVATAR_LOAD_TIMEOUT_MS);
            conn.setReadTimeout(AVATAR_LOAD_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                total += n;
                if (total > AVATAR_MAX_BYTES) return null;
            }
            byte[] bytes = out.toByteArray();
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) return null;
            // Guardar los BYTES crudos tal cual los almacenaría CachedImage.tsx
            // (base64 del cuerpo de la respuesta) para no duplicar ni romper el caché.
            try {
                FileOutputStream fos = new FileOutputStream(file);
                try {
                    fos.write(bytes);
                } finally {
                    fos.close();
                }
            } catch (Exception ignored) {
            }
            return bmp;
        } catch (Exception e) {
            Log.w(TAG, "Avatar load failed: " + e.getMessage());
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception ignored) {
                }
            }
            if (conn != null) conn.disconnect();
        }
    }

    // Avatar cuadrado con bordes redondeados para la notificación (estilo avatar
    // de la lista de chats): COPIA del Bitmap original recortada a esquinas
    // redondeadas. Ante cualquier problema devuelve el Bitmap original intacto:
    // la máscara jamás deja la notificación sin avatar. Solo para la notificación:
    // caché y Bitmap original jamás cambian.
    private static Bitmap createRoundedAvatarBitmap(Bitmap source) {
        if (source == null || source.isRecycled()) return source;
        try {
            int w = source.getWidth();
            int h = source.getHeight();
            if (w <= 0 || h <= 0) return source;

            // Escala pragmática para la notificación (≈256px) conservando la proporción.
            int side = Math.min(w, h);
            int outW = Math.max(160, Math.round(w * (256f / side)));
            int outH = Math.max(160, Math.round(h * (256f / side)));
            Bitmap scaled = Bitmap.createScaledBitmap(source, outW, outH, true);
            try {
                Bitmap output = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(output);
                canvas.drawColor(0x00000000); // fondo transparente explícito
                Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
                paint.setFilterBitmap(true);
                paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
                float radius = Math.min(outW, outH) * 0.24f;
                canvas.drawRoundRect(0f, 0f, outW, outH, radius, radius, paint);
                return output;
            } finally {
                if (scaled != source) scaled.recycle();
            }
        } catch (Exception e) {
            Log.w(TAG, "Rounded avatar mask failed, using original", e);
            return source;
        }
    }

    // Publica la notificación SIN foto de inmediato y, en un hilo en segundo plano
    // (daemon), actualiza con el LargeIcon si la foto carga. Nunca bloquea el hilo
    // principal ni retrasa la entrega de la notificación.
    private void maybeAttachAvatar(
        NotificationCompat.Builder builder, int notificationId, String avatarUrl
    ) {
        if (avatarUrl == null || avatarUrl.isEmpty()) return;
        // Directory.Data del plugin Filesystem (mismísimo directorio de CachedImage.tsx).
        final String cacheDir = getFilesDir().getAbsolutePath() + File.separator + "image_cache";
        final NotificationCompat.Builder b = builder;
        final int id = notificationId;
        final String url = avatarUrl;
        Thread worker = new Thread(() -> {
            Bitmap bmp = loadAvatarBitmap(cacheDir, url);
            if (bmp == null) return;
            try {
                // Avatar cuadrado con bordes redondeados para la notificación (copia).
                // Si la máscara falla se conserva el Bitmap original. El caché no se toca.
                Bitmap notificationAvatar = createRoundedAvatarBitmap(bmp);
                b.setLargeIcon(notificationAvatar);
                NotificationManager nm2 = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm2 != null) nm2.notify(id, b.build());
            } catch (Exception e) {
                Log.w(TAG, "Failed to attach avatar LargeIcon", e);
            }
        });
        worker.setDaemon(true);
        worker.start();
    }

    private void showMessageNotification(RemoteMessage message) {
        String title = message.getData().get("title");
        String body = message.getData().get("body");
        String chatId = message.getData().get("chatId");
        String contactId = message.getData().get("contactId");
        int notifCount = 1;
        try { notifCount = Integer.parseInt(message.getData().get("notificationCount")); } catch (Exception ignored) {}

        if (title == null) title = "RED ON";
        if (body == null) body = "Nuevo mensaje";

        int notificationId = (chatId != null ? chatId.hashCode() : (int) System.currentTimeMillis());

        String messageChannel = channelFor(message);

        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction("OPEN_CHAT");
        intent.putExtra("chatId", chatId);
        intent.putExtra("contactId", contactId);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, notificationId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Quick Reply action
        Intent replyIntent = new Intent(this, ReplyReceiver.class);
        replyIntent.setAction(REPLY_ACTION);
        replyIntent.putExtra("chatId", chatId);
        replyIntent.putExtra("contactId", contactId);
        int replyFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE;
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
            this, notificationId, replyIntent,
            replyFlags
        );
        RemoteInput remoteInput = new RemoteInput.Builder("reply_text")
            .setLabel("Escribe tu respuesta...")
            .build();

        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send, "Responder", replyPendingIntent)
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(true)
            .build();

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/notificacion");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, messageChannel)
            .setSmallIcon(R.drawable.ic_notification_wepa)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .addAction(replyAction)
            .setVibrate(new long[]{0, 300, 200, 300})
            .setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
            .setNumber(notifCount)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setColor(Color.parseColor("#1E88E5"));

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
        }
        maybeAttachAvatar(builder, notificationId, message.getData().get("avatarUrl"));
    }

    private void showForegroundMessageNotification(RemoteMessage message) {
        String title = message.getData().get("title");
        String body = message.getData().get("body");
        String chatId = message.getData().get("chatId");
        String contactId = message.getData().get("contactId");

        if (title == null) title = "RED ON";
        if (body == null) body = "Nuevo mensaje";

        int notificationId = (chatId != null ? chatId.hashCode() : (int) System.currentTimeMillis());

        String messageChannel = channelFor(message);

        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction("OPEN_CHAT");
        intent.putExtra("chatId", chatId);
        intent.putExtra("contactId", contactId);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, notificationId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/notificacion");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, messageChannel)
            .setSmallIcon(R.drawable.ic_notification_wepa)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setVibrate(new long[]{0, 300, 200, 300})
            // Privacidad consistente con showMessageNotification (background):
            // ocultar contenido detallado en pantalla bloqueada.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setColor(Color.parseColor("#1E88E5"));

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId + 100000, builder.build());
        }
        maybeAttachAvatar(builder, notificationId + 100000, message.getData().get("avatarUrl"));
    }
}

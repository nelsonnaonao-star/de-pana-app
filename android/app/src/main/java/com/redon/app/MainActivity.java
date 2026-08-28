package com.redon.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";
    private static final String PENDING_CALL_KEY = "redon_pending_call";
    private static MainActivity instance;

    public static Object getCapacitorBridge() {
        if (instance == null) return null;
        return instance.bridge;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        instance = this;
        createNotificationChannels();
        requestNotificationPermission();
        requestFullScreenIntentPermission();
        handleCallIntent(getIntent());
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleCallIntent(intent);
    }

    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String chatId = intent.getStringExtra("chatId");
        String callerId = intent.getStringExtra("callerId");
        String type = intent.getStringExtra("type");

        if ("ANSWER_CALL".equals(action) || (callerId != null && "call".equals(type))) {
            String callerName = intent.getStringExtra("callerName");
            String callType = intent.getStringExtra("callType");
            if (callType == null) callType = intent.getStringExtra("call_type");
            String json;
            try {
                org.json.JSONObject payload = new org.json.JSONObject();
                payload.put("chatId", chatId != null ? chatId : "");
                payload.put("callerId", callerId != null ? callerId : "");
                payload.put("callerName", callerName != null ? callerName : "");
                payload.put("callType", callType != null ? callType : "audio");
                json = payload.toString();
            } catch (Exception e) {
                json = "{\"chatId\":\"" + (chatId != null ? chatId : "") +
                    "\",\"callerId\":\"" + (callerId != null ? callerId : "") +
                    "\",\"callerName\":\"" + (callerName != null ? callerName : "") +
                    "\",\"callType\":\"" + (callType != null ? callType : "audio") + "\"}";
            }
            // Sticky "answer": se persiste para que JS pueda reconectar la llamada incluso si
            // el evento answer-call se pierde en un arranque en frío (listener aún no montado).
            persistPendingCall(json);
            try {
                bridge.triggerWindowJSEvent("answer-call", json);
            } catch (Exception e) {
                Log.e(TAG, "Failed to trigger JS event", e);
            }
            // Cancel the call notification when answered
            if (chatId != null) {
                int notificationId = ("call-" + chatId).hashCode();
                NotificationManagerCompat.from(this).cancel(notificationId);
                Log.d(TAG, "Cancelled call notification for chatId: " + chatId);

                // Avisar a cualquier IncomingCallActivity activa (e.g. contestada desde
                // la barra de notificaciones) para que detenga su ringtone al instante,
                // evitando que siga sonando tras responder.
                try {
                    Intent stopIntent = new Intent("com.redon.app.ACTION_CALL_ANSWERED");
                    stopIntent.putExtra("chatId", chatId);
                    sendBroadcast(stopIntent);
                } catch (Exception e) {
                    Log.w(TAG, "Failed to broadcast call answered", e);
                }
            }
        } else if ("OPEN_CHAT".equals(action) || "OPEN_APP".equals(action) || (chatId != null && "message".equals(type))) {
            if (chatId != null) {
                try {
                    bridge.triggerWindowJSEvent("open-chat", chatId);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to trigger open-chat JS event", e);
                }
            }
        } else if ("android.intent.action.MAIN".equals(action) && chatId != null) {
            // El intent del launcher puede conservar "extras" colgados de un push
            // anterior; NUNCA convertir eso en una llamada entrante, porque al abrir
            // la app desde el icono produciría una llamada fantasma. Las llamadas
            // reales ya entran por Realtime (primer plano) o por CallFcmService (fondo).
            try {
                bridge.triggerWindowJSEvent("open-chat", chatId);
            } catch (Exception e) {
                Log.e(TAG, "Failed to trigger open-chat JS event", e);
            }
        }
    }

    private void persistPendingCall(String json) {
        try {
            getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit()
                .putString(PENDING_CALL_KEY, json)
                .apply();
            Log.d(TAG, "Persisted pending answer: " + json);
        } catch (Exception e) {
            Log.e(TAG, "Failed to persist pending answer", e);
        }
    }

    private String getSoundPref(String key, String def) {
        try {
            SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
            String value = prefs.getString(key, null);
            return (value != null && !value.isEmpty()) ? value : def;
        } catch (Exception e) {
            return def;
        }
    }

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
        if ("ring2".equals(soundId)) return "ring1";
        if ("ring3".equals(soundId)) return "ring2";
        return "ringtone";
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).build();

            String msgSound = getSoundPref("redon_sound_message", "clasica");
            String callSound = getSoundPref("redon_sound_call", "ring1");
            String msgRaw = rawNameFor("message", msgSound);
            String callRaw = rawNameFor("call", callSound);

            // Forzar la recreación del channel base para aplicar el sonido guardado
            // (Android 8+ no permite cambiar el sonido de un channel existente).
            nm.deleteNotificationChannel("redon-messages");

            NotificationChannel messagesChannel = new NotificationChannel(
                "redon-messages", "Mensajes", NotificationManager.IMPORTANCE_HIGH
            );
            messagesChannel.setDescription("Notificaciones de mensajes");
            messagesChannel.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/raw/" + msgRaw), audioAttrs
            );
            messagesChannel.enableVibration(true);
            messagesChannel.setVibrationPattern(new long[]{0, 300, 200, 300});
            messagesChannel.enableLights(true);
            messagesChannel.setShowBadge(true);
            nm.createNotificationChannel(messagesChannel);

            // Forzar recreación del channel de llamadas para aplicar el sonido guardado.
            nm.deleteNotificationChannel("redon-calls");

            NotificationChannel callsChannel = new NotificationChannel(
                "redon-calls", "Llamadas", NotificationManager.IMPORTANCE_HIGH
            );
            callsChannel.setDescription("Notificaciones de llamadas entrantes");
            callsChannel.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/raw/" + callRaw), audioAttrs
            );
            callsChannel.enableVibration(true);
            callsChannel.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
            callsChannel.enableLights(true);
            callsChannel.setShowBadge(true);
            nm.createNotificationChannel(callsChannel);

            // Canales extra por tono alternativo, que CallFcmService usará según la selección.
            if (!"noti1".equals(msgSound)) {
                createToneChannel(nm, "redon-messages-noti1", "Mensajes 1", "noti1", new long[]{0, 300, 200, 300}, audioAttrs);
            }
            if (!"noti2".equals(msgSound)) {
                createToneChannel(nm, "redon-messages-noti2", "Mensajes 2", "noti2", new long[]{0, 300, 200, 300}, audioAttrs);
            }
            if (!"noti3".equals(msgSound)) {
                createToneChannel(nm, "redon-messages-noti3", "Mensajes 3", "noti3", new long[]{0, 300, 200, 300}, audioAttrs);
            }
            if (!"noti4".equals(msgSound)) {
                createToneChannel(nm, "redon-messages-noti4", "Mensajes 4", "noti4", new long[]{0, 300, 200, 300}, audioAttrs);
            }
            if (!"noti5".equals(msgSound)) {
                createToneChannel(nm, "redon-messages-noti5", "Mensajes 5", "noti5", new long[]{0, 300, 200, 300}, audioAttrs);
            }
            if (!"noti6".equals(msgSound)) {
                createToneChannel(nm, "redon-messages-noti6", "Mensajes 6", "noti6", new long[]{0, 300, 200, 300}, audioAttrs);
            }
            if (!"ring2".equals(callSound)) {
                createToneChannel(nm, "redon-calls-ring2", "Llamadas 2", "ring1", new long[]{0, 500, 300, 500, 300, 500}, audioAttrs);
            }
            if (!"ring3".equals(callSound)) {
                createToneChannel(nm, "redon-calls-ring3", "Llamadas 3", "ring2", new long[]{0, 500, 300, 500, 300, 500}, audioAttrs);
            }
        }
    }

    private void createToneChannel(NotificationManager nm, String id, String name, String raw, long[] vibration, AudioAttributes attrs) {
        NotificationChannel chan = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        chan.setDescription("Notificaciones de " + name);
        chan.setSound(Uri.parse("android.resource://" + getPackageName() + "/raw/" + raw), attrs);
        chan.enableVibration(true);
        chan.setVibrationPattern(vibration);
        chan.enableLights(true);
        chan.setShowBadge(true);
        nm.createNotificationChannel(chan);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
            }
        }
    }

    private void requestFullScreenIntentPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return;
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return;
        SharedPreferences prefs = getSharedPreferences("redon_prefs", Context.MODE_PRIVATE);
        if (prefs.getBoolean("fullscreen_intent_asked", false)) return;
        prefs.edit().putBoolean("fullscreen_intent_asked", true).apply();
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error opening USE_FULL_SCREEN_INTENT settings", e);
        }
    }
}

package com.redon.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.WindowManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        requestFullScreenIntentPermission();
        handleCallIntent(getIntent());
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
            try {
                String json = "{\"callerId\":\"" + (callerId != null ? callerId : "") +
                    "\",\"callerName\":\"" + (callerName != null ? callerName : "") +
                    "\",\"callType\":\"" + (callType != null ? callType : "audio") +
                    "\",\"chatId\":\"" + (chatId != null ? chatId : "") + "\"}";
                bridge.triggerWindowJSEvent("incoming-call", json);
            } catch (Exception e) {
                Log.e(TAG, "Failed to trigger JS event", e);
            }
        } else if ("OPEN_CHAT".equals(action) || (chatId != null && "message".equals(type))) {
            if (chatId != null) {
                try {
                    bridge.triggerWindowJSEvent("open-chat", chatId);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to trigger open-chat JS event", e);
                }
            }
        }
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION).build();

            NotificationChannel messagesChannel = new NotificationChannel(
                "redon-messages", "Mensajes", NotificationManager.IMPORTANCE_HIGH
            );
            messagesChannel.setDescription("Notificaciones de mensajes");
            messagesChannel.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/raw/notificacion"), audioAttrs
            );
            messagesChannel.enableVibration(true);
            messagesChannel.setVibrationPattern(new long[]{0, 300, 200, 300});
            messagesChannel.enableLights(true);
            messagesChannel.setShowBadge(true);
            nm.createNotificationChannel(messagesChannel);

            NotificationChannel callsChannel = new NotificationChannel(
                "redon-calls", "Llamadas", NotificationManager.IMPORTANCE_HIGH
            );
            callsChannel.setDescription("Notificaciones de llamadas entrantes");
            callsChannel.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/raw/ringtone"), audioAttrs
            );
            callsChannel.enableVibration(true);
            callsChannel.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
            callsChannel.enableLights(true);
            callsChannel.setShowBadge(true);
            nm.createNotificationChannel(callsChannel);
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

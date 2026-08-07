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
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.List;

public class CallFcmService extends FirebaseMessagingService {

    private static final String TAG = "CallFcmService";
    private static final String CHANNEL_CALLS = "redon-calls";
    private static final String CHANNEL_MESSAGES = "redon-messages";
    private static final String REPLY_ACTION = "com.redon.app.REPLY_MESSAGE";

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
        return CHANNEL_MESSAGES;
    }

    private void ensureChannel(String channelId, String name, String rawName, long[] vibration, String desc) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nmgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nmgr == null) return;
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
                showForegroundMessageNotification(message);
            }
        } else {
            // App is in background: show native notification with full-screen intent
            if ("call".equals(type)) {
                showCallNotification(message);
            } else {
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

        String messageChannel = resolveMessageChannel();

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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
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
    }

    private void showForegroundMessageNotification(RemoteMessage message) {
        String title = message.getData().get("title");
        String body = message.getData().get("body");
        String chatId = message.getData().get("chatId");
        String contactId = message.getData().get("contactId");

        if (title == null) title = "RED ON";
        if (body == null) body = "Nuevo mensaje";

        int notificationId = (chatId != null ? chatId.hashCode() : (int) System.currentTimeMillis());

        String messageChannel = resolveMessageChannel();

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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setVibrate(new long[]{0, 300, 200, 300})
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(Color.parseColor("#1E88E5"));

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId + 100000, builder.build());
        }
    }
}

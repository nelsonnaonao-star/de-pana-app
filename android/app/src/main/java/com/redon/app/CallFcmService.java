package com.redon.app;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
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
            // App is open: bridge to JS via Capacitor plugin.
            // This fires 'pushNotificationReceived' event in JS,
            // which pushCapacitor.ts handles to dispatch 'incoming-call' / 'new-message-received' CustomEvents.
            // PhoneSimulator.tsx listens for those events and shows the call overlay / handles messages.
            try {
                PushNotificationsPlugin.sendRemoteMessage(message);
                Log.d(TAG, "Bridged to Capacitor JS via PushNotificationsPlugin.onMessageReceived");
            } catch (Exception e) {
                Log.e(TAG, "Failed to bridge to Capacitor JS", e);
            }
        } else {
            // App is in background: show native notification OR full-screen activity
            if ("call".equals(type)) {
                showIncomingCallActivity(message);
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel chan = new NotificationChannel(
                CHANNEL_CALLS, "Llamadas", NotificationManager.IMPORTANCE_HIGH
            );
            chan.setDescription("Notificaciones de llamadas entrantes");
            chan.enableVibration(true);
            chan.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
            chan.enableLights(true);
            chan.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            NotificationManager nmgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nmgr != null) nmgr.createNotificationChannel(chan);
        }

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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_CALLS)
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
            .setSound(soundUri)
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel chan = new NotificationChannel(
                CHANNEL_MESSAGES, "Mensajes", NotificationManager.IMPORTANCE_HIGH
            );
            chan.setDescription("Notificaciones de mensajes");
            chan.enableVibration(true);
            chan.setVibrationPattern(new long[]{0, 300, 200, 300});
            chan.enableLights(true);
            chan.setShowBadge(true);
            chan.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            NotificationManager nmgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nmgr != null) nmgr.createNotificationChannel(chan);
        }

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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setSound(soundUri)
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
}

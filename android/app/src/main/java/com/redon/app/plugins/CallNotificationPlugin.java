package com.redon.app.plugins;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.util.Log;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.redon.app.MainActivity;
import com.redon.app.R;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "CallNotification")
public class CallNotificationPlugin extends Plugin {

    private static final String TAG = "CallNotificationPlugin";
    private static final String CHANNEL_CALLS = "redon-calls";

    @PluginMethod
    public void show(PluginCall call) {
        String callerName = call.getString("callerName", "Llamada entrante");
        String callType = call.getString("callType", "audio");
        String callerId = call.getString("callerId", "");
        String callerAvatar = call.getString("callerAvatar", "");
        String roomId = call.getString("roomId", "");

        Context context = getContext();
        int notificationId = callerId.hashCode();

        Intent answerIntent = new Intent(context, MainActivity.class);
        answerIntent.setAction("ANSWER_CALL");
        answerIntent.putExtra("callerName", callerName);
        answerIntent.putExtra("callerId", callerId);
        answerIntent.putExtra("callType", callType);
        answerIntent.putExtra("roomId", roomId);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent answerPendingIntent = PendingIntent.getActivity(
            context, notificationId, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent declineIntent = new Intent(context, com.redon.app.CallActionReceiver.class);
        declineIntent.setAction("DECLINE_CALL");
        declineIntent.putExtra("notificationId", notificationId);
        declineIntent.putExtra("callerId", callerId);
        declineIntent.putExtra("callerName", callerName);
        PendingIntent declinePendingIntent = PendingIntent.getBroadcast(
            context, notificationId + 1000, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent fullScreenIntent = new Intent(context, MainActivity.class);
        fullScreenIntent.setAction("ANSWER_CALL");
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callerId", callerId);
        fullScreenIntent.putExtra("callType", callType);
        fullScreenIntent.putExtra("roomId", roomId);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            context, notificationId + 2000, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        RemoteViews notificationLayout = new RemoteViews(context.getPackageName(), R.layout.call_notification);
        notificationLayout.setTextViewText(R.id.caller_name, callerName);
        notificationLayout.setTextViewText(R.id.call_type_label,
            callType.equals("video") ? "Videollamada entrante" : "Llamada entrante");
        notificationLayout.setImageViewResource(R.id.call_type_icon,
            callType.equals("video") ? android.R.drawable.ic_menu_camera : android.R.drawable.ic_menu_call);
        notificationLayout.setOnClickPendingIntent(R.id.btn_answer, answerPendingIntent);
        notificationLayout.setOnClickPendingIntent(R.id.btn_decline, declinePendingIntent);

        if (!callerAvatar.isEmpty()) {
            try {
                URL url = new URL(callerAvatar);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoInput(true);
                conn.connect();
                InputStream is = conn.getInputStream();
                Bitmap avatar = BitmapFactory.decodeStream(is);
                if (avatar != null) {
                    notificationLayout.setImageViewBitmap(R.id.caller_avatar, avatar);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to load avatar", e);
            }
        }

        Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/raw/ringtone");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setCustomContentView(notificationLayout)
            .setCustomHeadsUpContentView(notificationLayout)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(false)
            .setOngoing(true)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setSound(soundUri)
            .setVibrate(new long[]{0, 500, 300, 500, 300, 500})
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(Color.parseColor("#1E88E5"));

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
        }
        call.resolve();
    }

    @PluginMethod
    public void dismiss(PluginCall call) {
        String callerId = call.getString("callerId", "");
        Context context = getContext();
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && !callerId.isEmpty()) {
            nm.cancel(callerId.hashCode());
        }
        call.resolve();
    }
}

package com.redon.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class CallActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if ("DECLINE_CALL".equals(action)) {
            int notificationId = intent.getIntExtra("notificationId", -1);
            if (notificationId != -1) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(notificationId);
            }
            Intent appIntent = new Intent(context, MainActivity.class);
            appIntent.setAction("DECLINE_CALL");
            appIntent.putExtra("callerId", intent.getStringExtra("callerId"));
            appIntent.putExtra("callerName", intent.getStringExtra("callerName"));
            appIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(appIntent);
        }
    }
}

package com.redon.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.app.NotificationManager;

import androidx.core.app.RemoteInput;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;
import org.json.JSONException;

public class ReplyReceiver extends BroadcastReceiver {

    private static final String TAG = "ReplyReceiver";
    private static final String CAPACITOR_STORAGE = "CapacitorStorage";
    private static final String MESSAGES_API = "https://de-pana-app-kucq.onrender.com/api/messages/send";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!"com.redon.app.REPLY_MESSAGE".equals(intent.getAction())) return;

        Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
        if (remoteInput == null) return;

        CharSequence replyText = remoteInput.getCharSequence("reply_text");
        if (replyText == null || replyText.toString().trim().isEmpty()) return;

        String replyTextStr = replyText.toString().trim();
        String chatId = intent.getStringExtra("chatId");
        if (chatId == null || chatId.isEmpty()) return;

        int notificationId = chatId.hashCode();

        // Cancel the notification silently (no sound) - the message will be sent in background
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(notificationId);
        }

        // goAsync() keeps the BroadcastReceiver alive until finish() is called
        final PendingResult pendingResult = goAsync();

        // Read the Supabase session from Capacitor Storage SharedPreferences
        // Key format: sb-{projectRef}-auth-token (Supabase auth-js v2+)
        String accessToken = null;
        String userId = null;
        try {
            android.content.SharedPreferences prefs = context.getSharedPreferences(CAPACITOR_STORAGE, Context.MODE_PRIVATE);
            String sessionKey = findSessionKey(prefs);
            if (sessionKey == null) {
                Log.e(TAG, "No Supabase session key found in CapacitorStorage");
            } else {
                Log.d(TAG, "Found session key: " + sessionKey);
                String sessionJson = prefs.getString(sessionKey, null);
                if (sessionJson != null) {
                    JSONObject session = new JSONObject(sessionJson);
                    accessToken = session.optString("access_token", null);
                    JSONObject user = session.optJSONObject("user");
                    if (user != null) {
                        userId = user.optString("id", null);
                    }
                }
            }
        } catch (JSONException e) {
            Log.e(TAG, "Failed to parse session JSON from CapacitorStorage", e);
        }

        if (accessToken == null || userId == null) {
            Log.e(TAG, "Cannot send reply — token or userId missing from CapacitorStorage");
            pendingResult.finish();
            return;
        }

        final String fToken = accessToken;
        final String fUserId = userId;

        new Thread(() -> {
            try {
                java.net.URL url = new java.net.URL(MESSAGES_API);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + fToken);
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);

                JSONObject body = new JSONObject();
                body.put("chat_id", chatId);
                body.put("sender_id", fUserId);
                body.put("text", replyTextStr);
                body.put("type", "text");
                String jsonBody = body.toString();

                Log.d(TAG, "Sending reply: " + jsonBody);

                try (java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(jsonBody.getBytes("utf-8"));
                }

                int responseCode = conn.getResponseCode();
                Log.d(TAG, "Response code: " + responseCode);

                try (java.io.BufferedReader br = new java.io.BufferedReader(
                        new java.io.InputStreamReader(
                            responseCode >= 400 ? conn.getErrorStream() : conn.getInputStream(), "utf-8"))) {
                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        response.append(line.trim());
                    }
                    if (responseCode >= 400) {
                        Log.e(TAG, "Error response (" + responseCode + "): " + response);
                    } else {
                        Log.d(TAG, "Response: " + response);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to send reply", e);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private static String findSessionKey(android.content.SharedPreferences prefs) {
        java.util.Map<String, ?> all = prefs.getAll();
        for (String key : all.keySet()) {
            if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
                return key;
            }
        }
        return null;
    }
}
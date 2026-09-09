package com.redon.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
    private static final String SUPABASE_URL = "https://akgsylutbpgolurkcavh.supabase.co";
    private static final String SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjEzMTUsImV4cCI6MjA5NjQzNzMxNX0.2HhVDU7YYHM7zpcN8Moh8QCwEwhMH5bPj6leFqxzApo";
    private static final String TOKEN_REFRESH_API = SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token";
    // Margen de seguridad: se renueva si quedan menos de 60s de vida al access_token.
    private static final long TOKEN_MARGIN_SECONDS = 60;

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

        // client_id idempotente por respuesta: el servidor deduplica por (client_id, chat_id).
        final String clientId = java.util.UUID.randomUUID().toString();

        // Read the Supabase session from Capacitor Storage SharedPreferences
        // Key format: sb-{projectRef}-auth-token (Supabase auth-js v2+)
        String accessToken = null;
        String userId = null;
        String refreshToken = null;
        long expiresAt = 0L;
        String sessionKey = null;
        try {
            android.content.SharedPreferences prefs = context.getSharedPreferences(CAPACITOR_STORAGE, Context.MODE_PRIVATE);
            sessionKey = findSessionKey(prefs);
            if (sessionKey == null) {
                Log.e(TAG, "No Supabase session key found in CapacitorStorage");
            } else {
                Log.d(TAG, "Found session key: " + sessionKey);
                String sessionJson = prefs.getString(sessionKey, null);
                if (sessionJson != null) {
                    JSONObject session = new JSONObject(sessionJson);
                    accessToken = session.optString("access_token", null);
                    refreshToken = session.optString("refresh_token", null);
                    expiresAt = session.optLong("expires_at", 0L);
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

        // Si el access_token sigue vigente con margen de 60s, usar el flujo actual
        // (sin tocar el token ni la sesión guardada). En caso contrario se renueva
        // con refresh_token antes de enviar.
        boolean tokenFresh = expiresAt > 0
            && (System.currentTimeMillis() / 1000L) < (expiresAt - TOKEN_MARGIN_SECONDS);

        final String fAccessToken = accessToken;
        final String fUserId = userId;
        final String fRefreshToken = refreshToken;
        final String fSessionKey = sessionKey;
        final boolean fNeedRefresh = !tokenFresh;

        new Thread(() -> {
            try {
                String tokenToUse = fAccessToken;
                if (fNeedRefresh) {
                    if (fRefreshToken == null || fRefreshToken.isEmpty()) {
                        Log.e(TAG, "Access token expired and no refresh_token stored — reply not sent");
                        return;
                    }
                    String refreshed = refreshAccessToken(context, fSessionKey, fRefreshToken);
                    if (refreshed == null) {
                        Log.e(TAG, "Token refresh failed — reply dropped (never sent with expired token)");
                        return;
                    }
                    tokenToUse = refreshed;
                }

                java.net.URL url = new java.net.URL(MESSAGES_API);
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + tokenToUse);
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(15000);

                JSONObject body = new JSONObject();
                body.put("chat_id", chatId);
                body.put("sender_id", fUserId);
                body.put("client_id", clientId);
                body.put("text", replyTextStr);
                body.put("type", "text");
                String jsonBody = body.toString();

                Log.d(TAG, "Sending reply: " + jsonBody);

                try (java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(jsonBody.getBytes("utf-8"));
                }

                int responseCode = conn.getResponseCode();
                Log.d(TAG, "Response code: " + responseCode);

                java.io.InputStream is = responseCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (is == null) is = conn.getInputStream();
                try (java.io.BufferedReader br = new java.io.BufferedReader(
                        new java.io.InputStreamReader(is, "utf-8"))) {
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

    /**
     * Renueva el access_token vencido usando el refresh_token contra Supabase Auth.
     * En éxito reescribe la sesión completa en la MISMA clave de CapacitorStorage
     * (Supabase rota el refresh_token: si no se persiste el nuevo, el cliente JS
     * refrescaría luego con el token ya usado y perdería la sesión).
     * Retorna el nuevo access_token o null si falló (red, parse o rechazo de Auth).
     */
    private static String refreshAccessToken(Context context, String sessionKey, String refreshToken) {
        try {
            java.net.URL url = new java.net.URL(TOKEN_REFRESH_API);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("apikey", SUPABASE_ANON_KEY);
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);

            JSONObject body = new JSONObject();
            body.put("refresh_token", refreshToken);
            String jsonBody = body.toString();

            Log.d(TAG, "Refreshing access token (grant_type=refresh_token)");

            try (java.io.OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("utf-8"));
            }

            int responseCode = conn.getResponseCode();
            if (responseCode != 200) {
                java.io.InputStream es = conn.getErrorStream();
                if (es == null) es = conn.getInputStream();
                try (java.io.BufferedReader br = new java.io.BufferedReader(
                        new java.io.InputStreamReader(es, "utf-8"))) {
                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) {
                        response.append(line.trim());
                    }
                    Log.e(TAG, "Refresh failed (" + responseCode + "): " + response);
                }
                return null;
            }

            StringBuilder responseBody = new StringBuilder();
            try (java.io.BufferedReader br = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream(), "utf-8"))) {
                String line;
                while ((line = br.readLine()) != null) {
                    responseBody.append(line.trim());
                }
            }

            JSONObject newSession = new JSONObject(responseBody.toString());
            String newAccessToken = newSession.optString("access_token", null);
            String newRefreshToken = newSession.optString("refresh_token", null);
            if (newAccessToken == null || newAccessToken.isEmpty()
                || newRefreshToken == null || newRefreshToken.isEmpty()) {
                Log.e(TAG, "Refresh response missing access_token/refresh_token");
                return null;
            }

            persistRefreshedSession(context, sessionKey, newSession);
            return newAccessToken;
        } catch (Exception e) {
            Log.e(TAG, "Failed to refresh access token (network or parse)", e);
            return null;
        }
    }

    /**
     * Rotation: conserva la sesión existente (user y demás campos) y sobrescribe
     * los tokens nuevos de la sesión refrescada en la MISMA clave almacenada.
     */
    private static void persistRefreshedSession(Context context, String sessionKey, JSONObject newSession)
            throws JSONException {
        if (sessionKey == null) return;
        android.content.SharedPreferences prefs = context.getSharedPreferences(CAPACITOR_STORAGE, Context.MODE_PRIVATE);
        String sessionString = prefs.getString(sessionKey, null);
        if (sessionString != null) {
            JSONObject current = new JSONObject(sessionString);
            current.put("access_token", newSession.optString("access_token"));
            current.put("refresh_token", newSession.optString("refresh_token"));
            current.put("expires_in", newSession.optLong("expires_in", 0L));
            current.put("expires_at", newSession.optLong("expires_at", 0L));
            if (newSession.has("token_type")) {
                current.put("token_type", newSession.optString("token_type"));
            }
            prefs.edit().putString(sessionKey, current.toString()).apply();
        } else {
            prefs.edit().putString(sessionKey, newSession.toString()).apply();
        }
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
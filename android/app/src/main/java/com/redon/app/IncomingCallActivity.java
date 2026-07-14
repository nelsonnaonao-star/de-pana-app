package com.redon.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationManagerCompat;

public class IncomingCallActivity extends AppCompatActivity {

    private static final String TAG = "IncomingCallActivity";
    private Ringtone ringtone;
    private PowerManager.WakeLock wakeLock;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }

        // Full-screen flags
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        setContentView(R.layout.activity_incoming_call);

        // Acquire wake lock to keep screen on
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "redon:incoming_call"
            );
            wakeLock.acquire(30000); // 30s max
        }

        // Extract data from intent
        String chatId = getIntent().getStringExtra("chatId");
        String callerId = getIntent().getStringExtra("callerId");
        String rawCallerName = getIntent().getStringExtra("callerName");
        String rawCallType = getIntent().getStringExtra("callType");
        int notificationId = getIntent().getIntExtra("notificationId", ("call-" + (chatId != null ? chatId : "")).hashCode());

        final String callerName = rawCallerName != null ? rawCallerName : "Llamada entrante";
        final String callType = rawCallType != null ? rawCallType : "audio";

        // Set caller info
        TextView nameText = findViewById(R.id.caller_name);
        nameText.setText(callerName);

        TextView typeLabel = findViewById(R.id.call_type_label);
        if ("video".equals(callType)) {
            typeLabel.setText("Videollamada Entrante");
        } else {
            typeLabel.setText("Llamada de Voz Entrante");
        }

        // Start pulse animation
        View pulseRing = findViewById(R.id.pulse_ring);
        pulseRing.animate().cancel();
        pulseRing.setAlpha(0.6f);
        pulseRing.setScaleX(1f);
        pulseRing.setScaleY(1f);
        startPulseAnimation(pulseRing);

        // Play ringtone
        try {
            Uri ringtoneUri = Uri.parse("android.resource://" + getPackageName() + "/raw/ringtone");
            ringtone = RingtoneManager.getRingtone(getApplicationContext(), ringtoneUri);
            if (ringtone != null) {
                ringtone.play();
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to play ringtone", e);
        }

        // Answer button
        ImageButton btnAnswer = findViewById(R.id.btn_answer);
        btnAnswer.setOnClickListener(v -> {
            stopRingtone();
            dismissNotification(notificationId);

            // Launch main app with ANSWER_CALL action
            Intent answerIntent = new Intent(this, MainActivity.class);
            answerIntent.setAction("ANSWER_CALL");
            answerIntent.putExtra("chatId", chatId);
            answerIntent.putExtra("callerId", callerId);
            answerIntent.putExtra("callerName", callerName);
            answerIntent.putExtra("callType", callType);
            answerIntent.putExtra("type", "call");
            answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(answerIntent);
            finish();
        });

        // Decline button
        ImageButton btnDecline = findViewById(R.id.btn_decline);
        btnDecline.setOnClickListener(v -> {
            stopRingtone();
            dismissNotification(notificationId);

            // Notify JS side about declined call
            Intent declineIntent = new Intent(this, MainActivity.class);
            declineIntent.setAction("DECLINE_CALL");
            declineIntent.putExtra("callerId", callerId);
            declineIntent.putExtra("callerName", callerName);
            declineIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(declineIntent);
            finish();
        });

        // Auto-dismiss after 30 seconds
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!isFinishing()) {
                stopRingtone();
                dismissNotification(notificationId);
                finish();
            }
        }, 30000);
    }

    private void stopRingtone() {
        if (ringtone != null && ringtone.isPlaying()) {
            try { ringtone.stop(); } catch (Exception ignored) {}
        }
        ringtone = null;
    }

    private void dismissNotification(int notificationId) {
        try {
            NotificationManagerCompat.from(this).cancel(notificationId);
        } catch (Exception ignored) {}
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopRingtone();
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
    }

    @Override
    public void onBackPressed() {
        // Don't allow back press — must answer or decline
    }

    private void startPulseAnimation(View view) {
        view.animate()
            .scaleX(1.4f)
            .scaleY(1.4f)
            .alpha(0f)
            .setDuration(1000)
            .withEndAction(() -> {
                view.setScaleX(1f);
                view.setScaleY(1f);
                view.setAlpha(0.6f);
                if (!isFinishing()) {
                    startPulseAnimation(view);
                }
            })
            .start();
    }
}

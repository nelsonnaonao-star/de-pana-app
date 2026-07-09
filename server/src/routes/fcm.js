import express from 'express';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { initializeApp, getApps, cert } from 'firebase-admin';
import { getMessaging } from 'firebase-admin/messaging';

const router = express.Router();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const vapidPublicKey = process.env.VITE_FIREBASE_VAPID_KEY || '';
const vapidPrivateKey = process.env.FIREBASE_PRIVATE_VAPID_KEY || '';
const vapidEmail = process.env.VAPID_EMAIL || 'admin@redon.app';

let serviceAccount;

try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
        serviceAccount = JSON.parse(raw);
        if (serviceAccount.private_key) {
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
    }
} catch (e) {
    console.error("❌ Error al parsear FIREBASE_SERVICE_ACCOUNT:", e.message);
}

if (serviceAccount && getApps().length === 0) {
    try {
        initializeApp({
            credential: cert(serviceAccount)
        });
        console.log("✅ Firebase Admin inicializado correctamente con ESM imports.");
    } catch (error) {
        console.error("❌ Error en initializeApp:", error.message);
    }
}

function initFirebaseAdmin() {
  if (getApps().length === 0) return null;
  return { messaging: getMessaging };
}

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublicKey, vapidPrivateKey);
}

async function getTokens(profileId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('push_tokens')
      .select('token, device')
      .eq('profile_id', profileId);
    if (!error && data) return data;
  }
  return [];
}

// ─── REGISTER: called by the Capacitor app to store a new push token ────
// Stores directly in Supabase (Postgres) so tokens survive Render deploys.
router.post('/register', async (req, res) => {
  const { profile_id, token, device } = req.body;
  if (!profile_id || !token) {
    return res.status(400).json({ error: 'profile_id and token required' });
  }
  const tokenStr = typeof token === 'object' ? JSON.stringify(token) : token;

  if (supabase) {
    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { profile_id, token: tokenStr, device: device || 'android-fcm' },
        { onConflict: 'profile_id,token' }
      );
    if (error) {
      console.warn('[FCM] Register error:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  res.json({ ok: true });
});

// ─── SEND: called by the frontend (best-effort, for calls only now) ────
// Messages are sent via Supabase Database Webhook (see /webhook).
router.post('/send', async (req, res) => {
  const { profile_id, title, body, data } = req.body;
  console.log('[FCM-SEND] requested for profile:', profile_id, 'title:', title);
  if (!profile_id || !title) {
    return res.status(400).json({ error: 'profile_id and title required' });
  }

  const tokens = await getTokens(profile_id);
  console.log('[FCM-SEND] tokens found:', tokens.length);
  if (!tokens.length) {
    return res.json({ ok: true, sent: 0 });
  }

  const results = { web: 0, android: 0, errors: 0 };

  for (const t of tokens) {
    console.log('[FCM-SEND] device:', t.device);
    if (t.device === 'android-fcm' || t.device === 'android') {
      const admin = await initFirebaseAdmin();
      if (admin) {
        try {
          const isCall = data && data.type === 'call';
          const notifBody = isCall ? (body || 'Llamada entrante...') : (body || 'Nuevo mensaje');

          if (isCall) {
            const callData = data || {};
            const { callerAvatar, ...safeCallData } = callData;
            await admin.messaging().send({
              token: t.token,
              notification: { title: title || 'RED ON', body: notifBody },
              data: {
                title: title || 'RED ON', body: notifBody,
                badge: '1', notificationCount: '1',
                ...safeCallData,
                type: 'call',
              },
              android: {
                priority: 'high', ttl: 86400000,
                notification: {
                  channel_id: 'redon-calls', tag: 'call-' + (safeCallData.chatId || ''),
                  click_action: 'ANSWER_CALL', notification_count: 1,
                  visibility: 'public', sound: 'ringtone',
                },
              },
            });
          } else {
            const channelId = 'redon-messages';
            const msgData = data || {};
            const { callerAvatar: _, ...safeMsgData } = msgData;
            await admin.messaging().send({
              token: t.token,
              notification: { title: title || 'RED ON', body: notifBody },
              data: {
                title: title || 'RED ON', body: notifBody,
                badge: '1', notificationCount: '1',
                ...safeMsgData,
              },
              android: {
                priority: 'high', ttl: 86400000,
                notification: {
                  channel_id: channelId, tag: data?.chatId || 'redon-message',
                  click_action: 'OPEN_APP', notification_count: 1, visibility: 'public',
                  sound: 'notificacion',
                },
              },
            });
          }
          results.android++;
        } catch (err) {
          console.error('[FCM-SEND] FCM error:', err.message, err.code || '');
          results.errors++;
        }
      } else {
        console.error('[FCM-SEND] Firebase Admin not initialized');
        results.errors++;
      }
    } else {
      try {
        const subscription = JSON.parse(t.token);
        const payload = JSON.stringify({ title, body, data: data || {}, icon: '/icon.png', badge: '/badge.png' });
        await webpush.sendNotification(subscription, payload);
        console.log('[FCM-SEND] web push success');
        results.web++;
      } catch (err) {
        console.error('[FCM-SEND] web push error:', err.message);
        results.errors++;
      }
    }
  }

  console.log('[FCM-SEND] results:', JSON.stringify(results));
  res.json({ ok: true, ...results });
});

// ─── WEBHOOK: called by Supabase Database Webhook when a message or call is inserted ────
// Messages path is the RELIABLE server-side path (no frontend dependency).
// Calls path matches the same pattern — server-side push via DB trigger.
// Supabase sends: { type: 'INSERT', table: 'messages'|'calls', record: { ... }, ... }
router.post('/webhook', async (req, res) => {
  const startTime = Date.now();
  console.log('[FCM-WEBHOOK] Received webhook from Supabase');

  // ─── Webhook Secret Verification ────────────────────────────────
  const expectedSecret = process.env.FCM_WEBHOOK_SECRET;
  const receivedSecret = req.headers['x-fcm-secret'] || req.headers['authorization'] || '';
  if (expectedSecret) {
    const match = receivedSecret === expectedSecret
      || receivedSecret === `Bearer ${expectedSecret}`
      || receivedSecret === `fcm-secret ${expectedSecret}`;
    if (!match) {
      console.warn('[FCM-WEBHOOK] Invalid secret — rejecting');
      return res.status(401).json({ error: 'invalid webhook secret' });
    }
  }

  const { type, table, record } = req.body;
  console.log('[FCM-WEBHOOK] body keys:', Object.keys(req.body).join(', '));
  console.log('[FCM-WEBHOOK] type:', type, 'table:', table, 'has record:', !!record);

  if (type !== 'INSERT' || !record) {
    console.warn('[FCM-WEBHOOK] Invalid payload shape — ignoring');
    return res.status(200).json({ ok: true, ignored: 'invalid shape' });
  }

  if (table === 'messages') {
    // ── Messages path ──────────────────────────────────────────────
    const { chat_id, sender_id, text } = record;
    console.log('[FCM-WEBHOOK] messages record -> chat_id:', chat_id, 'sender_id:', sender_id, 'text_length:', text?.length);

    if (!chat_id || !sender_id) {
      console.warn('[FCM-WEBHOOK] missing chat_id or sender_id — skipping');
      return res.status(200).json({ ok: true, skipped: 'missing ids' });
    }

    // Find the recipient (the other participant in this chat)
    let receiverId = null;
    if (supabase) {
      try {
        const { data: participants, error } = await supabase
          .from('chat_participants')
          .select('profile_id')
          .eq('chat_id', chat_id)
          .neq('profile_id', sender_id)
          .limit(1);
        if (!error && participants && participants.length > 0) {
          receiverId = participants[0].profile_id;
        } else {
          // Fallback: look up the chat itself to find the other participant
          const { data: chat } = await supabase
            .from('chats')
            .select('profile_id, admin_id')
            .eq('id', chat_id)
            .single();
          if (chat) {
            receiverId = chat.profile_id === sender_id ? chat.admin_id : chat.profile_id;
          }
        }
      } catch (err) {
        console.error('[FCM-WEBHOOK] chat_participants exception:', err.message);
      }
    }

    if (!receiverId) {
      console.warn('[FCM-WEBHOOK] no receiver found for chat_id:', chat_id);
      return res.status(200).json({ ok: true, skipped: 'no receiver found' });
    }

    // Block check: if receiver has blocked sender, skip notification
    if (supabase) {
      try {
        const { data: blockCheck } = await supabase
          .from('blocks')
          .select('id')
          .eq('blocker_id', receiverId)
          .eq('blocked_id', sender_id)
          .maybeSingle();
        if (blockCheck) {
          console.log('[FCM-WEBHOOK] sender is blocked by receiver — skipping push');
          return res.status(200).json({ ok: true, skipped: 'blocked' });
        }
      } catch (err) {
        console.warn('[FCM-WEBHOOK] block check error:', err.message);
      }
    }

    // Get sender's name and avatar
    let senderName = 'RED ON';
    let senderAvatar = '';
    if (supabase) {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('name, avatar_url')
          .eq('id', sender_id)
          .single();
        if (!error && profile) {
          senderName = profile.name || 'RED ON';
          senderAvatar = profile.avatar_url || '';
        }
      } catch (err) {
        console.warn('[FCM-WEBHOOK] profile fetch exception:', err.message);
      }
    }

    // Get receiver's notification preferences (vista previa)
    let showPreview = true;
    if (supabase) {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('notif_config')
          .eq('id', receiverId)
          .single();
        if (!error && profile?.notif_config) {
          showPreview = profile.notif_config.preview !== false;
        }
      } catch (err) {
        console.warn('[FCM-WEBHOOK] notif_config lookup error:', err.message);
      }
    }

    // ── Auto-reply: send configured message if first contact ──
    if (supabase) {
      try {
        const { data: receiverProfile } = await supabase
          .from('profiles')
          .select('auto_reply_config')
          .eq('id', receiverId)
          .single();
        if (receiverProfile?.auto_reply_config?.enabled && receiverProfile.auto_reply_config.message) {
          const cfg = receiverProfile.auto_reply_config;
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('chat_id', chat_id)
            .eq('sender_id', receiverId);
          if (count === 0) {
            await supabase.from('messages').insert({
              chat_id,
              sender_id: receiverId,
              text: cfg.message,
              created_at: new Date().toISOString(),
            });
            console.log('[FCM-WEBHOOK] auto-reply enviado de', receiverId, 'en chat', chat_id);
          }
        }
      } catch (err) {
        console.warn('[FCM-WEBHOOK] auto-reply error:', err.message);
      }
    }

    const notifBody = showPreview ? (text || 'Nuevo mensaje') : 'Nuevo mensaje';
    const tokens = await getTokens(receiverId);
    if (!tokens.length) {
      console.warn('[FCM-WEBHOOK] no push tokens for receiver — skipping');
      return res.status(200).json({ ok: true, sent: 0, reason: 'no tokens for receiver' });
    }

    const results = { web: 0, android: 0, errors: 0 };

    for (const t of tokens) {
      if (t.device === 'android-fcm' || t.device === 'android') {
        const admin = await initFirebaseAdmin();
        if (admin) {
          try {
            await admin.messaging().send({
              token: t.token,
              notification: { title: senderName, body: notifBody },
              data: {
                title: senderName, body: notifBody,
                badge: '1', notificationCount: '1',
                chatId: chat_id, type: 'message', contactId: sender_id,
              },
              android: {
                priority: 'high', ttl: 86400000,
                notification: {
                  channel_id: 'redon-messages', tag: chat_id,
                  click_action: 'OPEN_APP', notification_count: 1, visibility: 'public',
                  sound: 'notificacion',
                },
              },
            });
            results.android++;
          } catch (err) {
            console.error('[FCM-WEBHOOK] FCM send error:', err.message, err.code || '');
            results.errors++;
          }
        } else {
          results.errors++;
        }
      } else {
        try {
          const subscription = JSON.parse(t.token);
          await webpush.sendNotification(subscription, JSON.stringify({
            title: senderName, body: notifBody,
            data: { chatId: chat_id, type: 'message', contactId: sender_id },
            icon: '/icon.png', badge: '/badge.png',
          }));
          results.web++;
        } catch (err) {
          console.error('[FCM-WEBHOOK] Web push error:', err.message);
          results.errors++;
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log('[FCM-WEBHOOK] messages done in', elapsed, 'ms — results:', JSON.stringify(results));
    return res.json({ ok: true, ...results });

  } else if (table === 'calls') {
    // ── Calls path ────────────────────────────────────────────────
    const { chat_id, caller_id, callee_id, call_type } = record;
    console.log('[FCM-WEBHOOK] calls record -> chat_id:', chat_id, 'caller_id:', caller_id, 'callee_id:', callee_id);

    if (!chat_id || !caller_id || !callee_id) {
      console.warn('[FCM-WEBHOOK] missing chat_id, caller_id, or callee_id — skipping');
      return res.status(200).json({ ok: true, skipped: 'missing ids' });
    }

    // Get caller's name and avatar
    let callerName = 'RED ON';
    let callerAvatar = '';
    if (supabase) {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('name, avatar_url')
          .eq('id', caller_id)
          .single();
        if (!error && profile) {
          callerName = profile.name || 'RED ON';
          callerAvatar = profile.avatar_url || '';
        }
      } catch (err) {
        console.warn('[FCM-WEBHOOK] caller profile exception:', err.message);
      }
    }

    // Get callee's push tokens
    const tokens = await getTokens(callee_id);
    if (!tokens.length) {
      console.warn('[FCM-WEBHOOK] no push tokens for callee — skipping');
      return res.status(200).json({ ok: true, sent: 0, reason: 'no tokens for callee' });
    }

    const results = { web: 0, android: 0, errors: 0 };

    for (const t of tokens) {
      if (t.device === 'android-fcm' || t.device === 'android') {
        const admin = await initFirebaseAdmin();
        if (admin) {
          try {
            await admin.messaging().send({
              token: t.token,
              notification: { title: callerName, body: 'Llamada entrante' },
              data: {
                title: callerName, body: 'Llamada entrante',
                badge: '1', notificationCount: '1',
                chatId: chat_id, type: 'call',
                callerId: caller_id, callerName,
                callType: call_type || 'audio',
              },
              android: {
                priority: 'high', ttl: 86400000,
                notification: {
                  channel_id: 'redon-calls', tag: 'call-' + chat_id,
                  click_action: 'ANSWER_CALL', notification_count: 1,
                  visibility: 'public', sound: 'ringtone',
                },
              },
            });
            results.android++;
          } catch (err) {
            console.error('[FCM-WEBHOOK] FCM call push error:', err.message, err.code || '');
            results.errors++;
          }
        } else {
          results.errors++;
        }
      } else {
        try {
          const subscription = JSON.parse(t.token);
          await webpush.sendNotification(subscription, JSON.stringify({
            title: callerName, body: 'Llamada entrante...',
            data: { chatId: chat_id, type: 'call', callerId: caller_id, callerName, callType: call_type || 'audio' },
            icon: '/icon.png', badge: '/badge.png', requireInteraction: true,
          }));
          results.web++;
        } catch (err) {
          console.error('[FCM-WEBHOOK] Web push error:', err.message);
          results.errors++;
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log('[FCM-WEBHOOK] calls done in', elapsed, 'ms — results:', JSON.stringify(results));
    return res.json({ ok: true, ...results });

  } else {
    console.warn('[FCM-WEBHOOK] Unknown table:', table, '— ignoring');
    return res.status(200).json({ ok: true, ignored: 'unknown table' });
  }
});

export default router;

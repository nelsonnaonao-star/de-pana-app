import express from 'express';
import webpush from 'web-push';
import { supabaseAdmin } from '../db.js';
import { initializeApp, getApps, cert } from 'firebase-admin';
import { getMessaging } from 'firebase-admin/messaging';

const router = express.Router();

const supabase = supabaseAdmin;

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
    console.error("[FCM] Error parsing FIREBASE_SERVICE_ACCOUNT:", e.message);
}

if (serviceAccount && getApps().length === 0) {
    try {
        initializeApp({
            credential: cert(serviceAccount)
        });
    } catch (error) {
        console.error("[FCM] Error in initializeApp:", error.message);
    }
}

let firebaseMessaging = null;
function initFirebaseAdmin() {
  if (firebaseMessaging) return firebaseMessaging;
  if (getApps().length === 0) {
    return null;
  }
  try {
    firebaseMessaging = { messaging: () => getMessaging() };
    return firebaseMessaging;
  } catch (e) {
    console.error('[FCM] Failed to get Messaging instance:', e.message);
    return null;
  }
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

router.post('/register', async (req, res) => {
  const { profile_id, token, device } = req.body;
  if (!profile_id || !token) {
    return res.status(400).json({ error: 'profile_id and token required' });
  }

  if (req.userId !== profile_id && req.userRole !== 'service_role') {
    return res.status(403).json({ error: 'No puedes registrar tokens para otro usuario' });
  }

  const tokenStr = typeof token === 'object' ? JSON.stringify(token) : token;

  if (!supabase) {
    return res.status(500).json({ error: 'Server not configured for push notifications' });
  }

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { profile_id, token: tokenStr, device: device || 'android-fcm' },
      { onConflict: 'profile_id,token' }
    );
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ ok: true });
});

router.post('/send', async (req, res) => {
  const { profile_id, title, body, data } = req.body;
  if (!profile_id || !title) {
    return res.status(400).json({ error: 'profile_id and title required' });
  }

  const tokens = await getTokens(profile_id);
  if (!tokens.length) {
    return res.json({ ok: true, sent: 0 });
  }

  const results = { web: 0, android: 0, errors: 0 };

  for (const t of tokens) {
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
              data: {
                title: title || 'RED ON', body: notifBody,
                badge: '1', notificationCount: '1',
                ...safeCallData,
                type: 'call',
              },
              android: {
                priority: 'high', ttl: 86400000,
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
          results.errors++;
        }
      } else {
        results.errors++;
      }
    } else {
      try {
        const subscription = JSON.parse(t.token);
        const payload = JSON.stringify({ title, body, data: data || {}, icon: '/icon.png', badge: '/badge.png' });
        await webpush.sendNotification(subscription, payload);
        results.web++;
      } catch (err) {
        results.errors++;
      }
    }
  }

  res.json({ ok: true, ...results });
});

// ─── WEBHOOK: called by Supabase Database Webhook ────────────────
// This endpoint is PUBLIC — authenticated via webhook secret, not JWT
router.post('/webhook', async (req, res) => {
  const startTime = Date.now();

  const expectedSecret = process.env.FCM_WEBHOOK_SECRET;
  const receivedSecret = req.headers['x-fcm-secret'] || req.headers['authorization'] || '';
  if (expectedSecret) {
    const match = receivedSecret === expectedSecret
      || receivedSecret === `Bearer ${expectedSecret}`
      || receivedSecret === `fcm-secret ${expectedSecret}`;
    if (!match) {
      return res.status(401).json({ error: 'invalid webhook secret' });
    }
  }

  const { type, table, record } = req.body;

  if (type !== 'INSERT' || !record) {
    return res.status(200).json({ ok: true, ignored: 'invalid shape' });
  }

  if (!supabase) {
    return res.status(200).json({ ok: false, error: 'Supabase not configured' });
  }

  if (table === 'messages') {
    const { chat_id, sender_id, text } = record;

    if (!chat_id || !sender_id) {
      return res.status(200).json({ ok: true, skipped: 'missing ids' });
    }

    let receiverId = null;
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

    if (!receiverId) {
      return res.status(200).json({ ok: true, skipped: 'no receiver found' });
    }

    try {
      const { data: blockCheck } = await supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', receiverId)
        .eq('blocked_id', sender_id)
        .maybeSingle();
      if (blockCheck) {
        return res.status(200).json({ ok: true, skipped: 'blocked' });
      }
    } catch (err) {
      // blocks table may not exist
    }

    let senderName = 'RED ON';
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('name, avatar_url')
        .eq('id', sender_id)
        .single();
      if (!error && profile) {
        senderName = profile.name || 'RED ON';
      }
    } catch (err) {
      // ignore
    }

    let showPreview = true;
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
      // ignore
    }

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
        }
      }
    } catch (err) {
      // ignore
    }

    const notifBody = showPreview ? (text || 'Nuevo mensaje') : 'Nuevo mensaje';
    const tokens = await getTokens(receiverId);
    if (!tokens.length) {
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
          results.errors++;
        }
      }
    }

    return res.json({ ok: true, ...results });

  } else if (table === 'calls') {
    const { id: recordId, chat_id, caller_id, callee_id, call_type } = record;

    if (!chat_id || !caller_id || !callee_id) {
      return res.status(200).json({ ok: true, skipped: 'missing ids' });
    }

    let callerName = 'RED ON';
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('name, avatar_url')
        .eq('id', caller_id)
        .single();
      if (!error && profile) {
        callerName = profile.name || 'RED ON';
      }
    } catch (err) {
      // ignore
    }

    const tokens = await getTokens(callee_id);
    if (!tokens.length) {
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
              data: {
                title: callerName, body: 'Llamada entrante',
                badge: '1', notificationCount: '1',
                chatId: chat_id, type: 'call',
                callerId: caller_id, callerName,
                callType: call_type || 'audio',
                callId: recordId,
              },
              android: {
                priority: 'high', ttl: 86400000,
              },
            });
            results.android++;
          } catch (err) {
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
            data: { chatId: chat_id, type: 'call', callerId: caller_id, callerName, callType: call_type || 'audio', callId: recordId },
            icon: '/icon.png', badge: '/badge.png', requireInteraction: true,
          }));
          results.web++;
        } catch (err) {
          results.errors++;
        }
      }
    }

    return res.json({ ok: true, ...results });

  } else {
    return res.status(200).json({ ok: true, ignored: 'unknown table' });
  }
});

export default router;

import express from 'express';
import webpush from 'web-push';
import crypto from 'crypto';
import { supabaseAdmin } from '../db.js';
import { initializeApp, getApps, cert } from 'firebase-admin';
import { isGroupMuted } from './groups.js';
import { sendAndroidPush, isAndroidDevice, sanitizeFcmData } from '../lib/fcmPush.js';

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
    return res.status(500).json({ error: 'Error interno del servidor' });
  }

  res.json({ ok: true });
});

router.post('/send', async (req, res) => {
  const { profile_id, title, body, data } = req.body;
  if (!profile_id || !title) {
    return res.status(400).json({ error: 'profile_id and title required' });
  }

  if (req.userId !== profile_id && req.userRole !== 'service_role') {
    return res.status(403).json({ error: 'No puedes enviar notificaciones para otro usuario' });
  }

  const tokens = await getTokens(profile_id);
  if (!tokens.length) {
    return res.json({ ok: true, sent: 0 });
  }

  const isCall = data && data.type === 'call';
  const notifBody = isCall ? (body || 'Llamada entrante...') : (body || 'Nuevo mensaje');
  const baseData = sanitizeFcmData({
    ...(data || {}),
    title: title || 'RED ON',
    body: notifBody,
    badge: '1',
    notificationCount: '1',
    ...(isCall ? { type: 'call' } : {}),
  });
  delete baseData.callerAvatar;

  const androidStats = await sendAndroidPush(
    tokens.filter(t => isAndroidDevice(t.device)),
    (token) => ({
      token,
      data: baseData,
      android: { priority: 'high', ttl: 86400000 },
    })
  );

  const results = { web: 0, android: androidStats.sent, errors: androidStats.failed };

  for (const t of tokens.filter(t => !isAndroidDevice(t.device))) {
    try {
      const subscription = JSON.parse(t.token);
      const payload = JSON.stringify({ title, body, data: data || {}, icon: '/icon.png', badge: '/badge.png' });
      await webpush.sendNotification(subscription, payload);
      results.web++;
    } catch (err) {
      results.errors++;
    }
  }

  res.json({ ok: true, ...results });
});

// ─── WEBHOOK: called by Supabase Database Webhook ────────────────
// This endpoint is PUBLIC — authenticated via webhook secret, not JWT
router.post('/webhook', async (req, res) => {
  const startTime = Date.now();

  const expectedSecret = process.env.FCM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('[FCM-WEBHOOK] FCM_WEBHOOK_SECRET no configurado — rechazando petición');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  const receivedSecret = req.headers['x-fcm-secret'] || req.headers['authorization'] || '';

  // Timing-safe comparison to prevent timing attacks on the webhook secret.
  // We hash both secrets (SHA-256 hex) so buffer lengths always match.
  function safeSecretCompare(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string') return false;
    const receivedHash = crypto.createHash('sha256').update(received).digest('hex');
    const expectedHash = crypto.createHash('sha256').update(expected).digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(receivedHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  }

  const match = safeSecretCompare(receivedSecret, expectedSecret)
    || safeSecretCompare(receivedSecret, `Bearer ${expectedSecret}`)
    || safeSecretCompare(receivedSecret, `fcm-secret ${expectedSecret}`);
  if (!match) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }

  const { type, table, record, old_record } = req.body;

  if (!record) {
    return res.status(200).json({ ok: true, ignored: 'invalid shape' });
  }

  // Whitelist: only allow known type/table combinations from Supabase Database Webhooks
  const allowedWebhookEvents = [
    { type: 'INSERT', table: 'messages' },
    { type: 'INSERT', table: 'calls' },
    { type: 'UPDATE', table: 'calls' },
    { type: 'INSERT', table: 'chat_participants' },
  ];
  if (!allowedWebhookEvents.some(e => e.type === type && e.table === table)) {
    return res.status(200).json({ ok: true, ignored: 'unexpected type/table' });
  }

  if (!supabase) {
    return res.status(200).json({ ok: false, error: 'Supabase not configured' });
  }

  if (type === 'INSERT' && table === 'messages') {
    const { chat_id, sender_id, text, type: msgType, file_url, document_name, document_size, document_type, mime_type, image_url, video_url, audio_url } = record;

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
    let senderAvatar = '';
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

    // Send push notification to all participants
    try {
      const { data: chat } = await supabase
        .from('chats')
        .select('is_group, name')
        .eq('id', chat_id)
        .single();
      const isGroup = chat?.is_group;
      const chatName = chat?.name || 'RED ON';

      // Si el grupo está silenciado, no se envía push a ningún participante.
      if (isGroup && (await isGroupMuted(chat_id))) {
        return res.json({ ok: true, skipped: 'group muted' });
      }

      let receiverIds = [];
      if (isGroup) {
        const { data: participants } = await supabase
          .from('chat_participants')
          .select('profile_id')
          .eq('chat_id', chat_id)
          .neq('profile_id', sender_id);
        receiverIds = (participants || []).map(p => p.profile_id);
      } else if (receiverId) {
        receiverIds = [receiverId];
      }

      const title = isGroup ? chatName : (senderName || 'RED ON');

      await Promise.allSettled(receiverIds.map(async (rid) => {
        try {
          const { data: blockCheck } = await supabase
            .from('blocks')
            .select('id')
            .eq('blocker_id', rid)
            .eq('blocked_id', sender_id)
            .maybeSingle();
          if (blockCheck) return;
        } catch {}

        let showPreviewForUser = showPreview;
        if (isGroup) {
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('notif_config')
              .eq('id', rid)
              .single();
            if (profile?.notif_config) {
              showPreviewForUser = profile.notif_config.preview !== false;
            }
          } catch {}
        }

        const { data: tokens } = await supabase
          .from('push_tokens')
          .select('token, device')
          .eq('profile_id', rid);
        if (!tokens?.length) return;

        const messageData = sanitizeFcmData({
          title,
          body: showPreviewForUser ? (text || 'Nuevo mensaje') : 'Nuevo mensaje',
          type: 'message',
          chatId: chat_id,
          messageId: record.id,
          contactId: sender_id,
          avatarUrl: senderAvatar,
          is_group: isGroup ? 'true' : 'false',
          ts: record.created_at || new Date().toISOString(),
          hasPreview: showPreviewForUser ? 'true' : 'false',
          is_ephemeral: record.is_ephemeral ? 'true' : 'false',
          ephemeral_expires_at: record.ephemeral_expires_at || '',
          msgType: msgType || 'text',
          fileUrl: file_url,
          documentName: document_name,
          documentSize: document_size,
          documentType: document_type,
          mimeType: mime_type,
          imageUrl: image_url,
          videoUrl: video_url,
          audioUrl: audio_url,
        });

        await sendAndroidPush(
          tokens.filter(t => isAndroidDevice(t.device)),
          (token) => ({
            token,
            data: messageData,
            android: { priority: 'high', ttl: 86400000 },
          })
        );
      }));
    } catch (err) {
      console.error('[FCM-WEBHOOK] push send failed:', err.message);
    }

    return res.json({ ok: true });

  } else if (table === 'calls') {
    const { id: recordId, chat_id, caller_id, callee_id, call_type, room_id } = record;

    if (type === 'UPDATE') {
      const oldStatus = old_record?.status;
      const newStatus = record?.status;
      const endedStatuses = ['ended', 'missed'];

      if (oldStatus === 'ringing' && endedStatuses.includes(newStatus) && callee_id) {
        console.log(`[FCM-WEBHOOK] Call ${recordId} dismissed (${newStatus}) — notifying callee ${callee_id}`);
        const tokens = await getTokens(callee_id);
        const dismissedData = sanitizeFcmData({
          type: 'call_dismissed',
          callId: recordId,
          chatId: chat_id || '',
          callerId: caller_id || '',
        });
        const androidStats = await sendAndroidPush(
          tokens.filter(t => isAndroidDevice(t.device)),
          (token) => ({
            token,
            data: dismissedData,
            android: { priority: 'high', ttl: 86400000 },
          })
        );
        const results = { web: 0, android: androidStats.sent, errors: androidStats.failed };
        for (const t of tokens.filter(t => !isAndroidDevice(t.device))) {
          try {
            const subscription = JSON.parse(t.token);
            await webpush.sendNotification(subscription, JSON.stringify({
              title: 'Llamada finalizada',
              body: 'La llamada entrante ha terminado',
              data: { type: 'call_dismissed', callId: recordId, chatId: chat_id || '', callerId: caller_id || '' },
            }));
            results.web++;
          } catch (err) {
            results.errors++;
          }
        }
        return res.json({ ok: true, ...results });
      }

      return res.status(200).json({ ok: true, ignored: 'no ring->end transition' });
    }

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

    const callData = sanitizeFcmData({
      title: callerName,
      body: 'Llamada entrante',
      badge: '1',
      notificationCount: '1',
      chatId: chat_id,
      type: 'call',
      callerId: caller_id,
      callerName,
      callType: call_type || 'audio',
      callId: recordId,
      roomId: room_id || '',
    });
    const androidStats = await sendAndroidPush(
      tokens.filter(t => isAndroidDevice(t.device)),
      (token) => ({
        token,
        data: callData,
        android: { priority: 'high', ttl: 86400000 },
      })
    );
    const results = { web: 0, android: androidStats.sent, errors: androidStats.failed };

    for (const t of tokens.filter(t => !isAndroidDevice(t.device))) {
      try {
        const subscription = JSON.parse(t.token);
        await webpush.sendNotification(subscription, JSON.stringify({
          title: callerName, body: 'Llamada entrante...',
          data: { chatId: chat_id, type: 'call', callerId: caller_id, callerName, callType: call_type || 'audio', callId: recordId, roomId: room_id || '' },
          icon: '/icon.png', badge: '/badge.png', requireInteraction: true,
        }));
        results.web++;
      } catch (err) {
        results.errors++;
      }
    }

    return res.json({ ok: true, ...results });

  } else if (type === 'INSERT' && table === 'chat_participants') {
    const { chat_id, profile_id } = record;
    if (!chat_id || !profile_id) {
      return res.status(200).json({ ok: true, skipped: 'missing ids' });
    }

    try {
      const { data: chat } = await supabase
        .from('chats')
        .select('name, is_group')
        .eq('id', chat_id)
        .single();

      if (!chat || !chat.is_group) {
        return res.status(200).json({ ok: true, ignored: 'not a group' });
      }

      // Get the person who added (the admin or whoever triggered the insert)
      // We look up the chat admin as the adder
      const { data: chatDetail } = await supabase
        .from('chats')
        .select('admin_id, name')
        .eq('id', chat_id)
        .single();

      let adderName = 'Alguien';
      if (chatDetail?.admin_id) {
        const { data: adderProfile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', chatDetail.admin_id)
          .single();
        if (adderProfile?.name) adderName = adderProfile.name;
      }

      const groupName = chatDetail?.name || 'Grupo';
      const title = 'Nuevo grupo';
      const body = `${adderName} te agregó a "${groupName}"`;

      // El admin que agrega/crea NO recibe su propio aviso "te agregaron":
      // el creador no debe escuchar el sonido de grupo al crear/agregar.
      if (chatDetail?.admin_id && chatDetail.admin_id === profile_id) {
        return res.json({ ok: true, sent: 0, reason: 'adder is admin' });
      }

      const tokens = await getTokens(profile_id);
      if (!tokens.length) {
        return res.json({ ok: true, sent: 0, reason: 'no tokens' });
      }

      const groupData = sanitizeFcmData({
        title,
        body,
        badge: '1',
        notificationCount: '1',
        type: 'group_added',
        is_group: 'true',
        chatId: chat_id,
      });
      const androidStats = await sendAndroidPush(
        tokens.filter(t => isAndroidDevice(t.device)),
        (token) => ({
          token,
          data: groupData,
          android: { priority: 'high', ttl: 86400000 },
        })
      );
      const results = { web: 0, android: androidStats.sent, errors: androidStats.failed };

      for (const t of tokens.filter(t => !isAndroidDevice(t.device))) {
        try {
          const subscription = JSON.parse(t.token);
          await webpush.sendNotification(subscription, JSON.stringify({
            title, body,
            data: { type: 'group_added', is_group: 'true', chatId: chat_id },
            icon: '/icon.png',
          }));
          results.web++;
        } catch (err) {
          results.errors++;
        }
      }

      return res.json({ ok: true, ...results });
    } catch (err) {
      console.error('[FCM-WEBHOOK] chat_participants error:', err.message);
      return res.status(200).json({ ok: false, error: err.message });
    }

  } else {
    return res.status(200).json({ ok: true, ignored: 'unknown table' });
  }
});

export default router;

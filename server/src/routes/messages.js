import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '../db.js';
import { getMessaging } from 'firebase-admin/messaging';

const router = Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Demasiados mensajes. Espera un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const reactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiadas reacciones. Espera un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const VALID_MESSAGE_TYPES = ['text', 'image', 'sticker', 'video', 'audio', 'file', 'voice_note', 'video_note', 'poll', 'location'];
const MAX_TEXT_LENGTH = 5000;
const MAX_EMOJI_LENGTH = 10;

function sanitizeText(text) {
  if (!text || typeof text !== 'string') return null;
  return text.replace(/<[^>]*>/g, '').trim().slice(0, MAX_TEXT_LENGTH) || null;
}

async function isChatMember(chatId, userId) {
  const { data: chat } = await supabaseAdmin
    .from('chats')
    .select('profile_id, admin_id, is_group')
    .eq('id', chatId)
    .maybeSingle();

  if (!chat) return false;
  if (chat.profile_id === userId || chat.admin_id === userId) return true;

  if (chat.is_group) {
    const { data: participant } = await supabaseAdmin
      .from('chat_participants')
      .select('profile_id')
      .eq('chat_id', chatId)
      .eq('profile_id', userId)
      .maybeSingle();
    return !!participant;
  }

  return false;
}

async function sendPushToChat(chatId, senderId, senderName, text) {
  try {
    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('profile_id, admin_id, is_group')
      .eq('id', chatId)
      .maybeSingle();
    if (!chat) return;

    let receiverIds = [];
    if (chat.is_group) {
      const { data: participants } = await supabaseAdmin
        .from('chat_participants')
        .select('profile_id')
        .eq('chat_id', chatId)
        .neq('profile_id', senderId);
      receiverIds = (participants || []).map(p => p.profile_id);
    } else {
      const rid = chat.profile_id === senderId ? chat.admin_id : chat.profile_id;
      if (rid) receiverIds = [rid];
    }

    for (const rid of receiverIds) {
      const { data: tokens } = await supabaseAdmin
        .from('push_tokens')
        .select('token, device')
        .eq('profile_id', rid);
      if (!tokens?.length) continue;

      for (const t of tokens) {
        if (t.device === 'android-fcm' || t.device === 'android') {
          try {
            await getMessaging().send({
              token: t.token,
              data: { title: senderName || 'RED ON', body: text || 'Nuevo mensaje', type: 'message', chatId, contactId: senderId },
              android: { priority: 'high', ttl: 86400000 },
            });
          } catch {}
        }
      }
    }
  } catch {}
}

// ─── Send message ────────────────────────────────────────────────
router.post('/send', sendLimiter, async (req, res) => {
  try {
    const msg = req.body;
    if (!msg.chat_id || !msg.sender_id) {
      return res.status(400).json({ error: 'chat_id y sender_id requeridos' });
    }

    if (req.userId !== msg.sender_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No puedes enviar mensajes como otro usuario' });
    }

    if (!(await isChatMember(msg.chat_id, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const msgType = msg.type || 'text';
    if (!VALID_MESSAGE_TYPES.includes(msgType)) {
      return res.status(400).json({ error: 'Tipo de mensaje inválido' });
    }

    const sanitizedText = sanitizeText(msg.text);

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        chat_id: msg.chat_id,
        sender_id: msg.sender_id,
        receiver_id: msg.receiver_id || null,
        text: sanitizedText,
        type: msgType,
        status: 'sent',
        created_at: new Date().toISOString(),
        edited: false,
        forwarded: !!msg.forwarded,
        has_image: !!msg.image_url,
        image_url: msg.image_url || null,
        image_alt: msg.image_alt || null,
        has_audio: !!msg.audio_url,
        audio_url: msg.audio_url || null,
        audio_duration: msg.audio_duration || null,
        mime_type: msg.mime_type || null,
        has_video: !!msg.video_url,
        video_url: msg.video_url || null,
        has_document: !!msg.document_name,
        document_name: msg.document_name || null,
        document_size: msg.document_size || null,
        document_type: msg.document_type || null,
        has_location: !!msg.latitude,
        latitude: msg.latitude || null,
        longitude: msg.longitude || null,
        location_name: msg.location_name || null,
        reply_to_id: msg.reply_to_id || null,
        reply_to_text: msg.reply_to_text || null,
        reply_to_sender: msg.reply_to_sender || null,
        sticker_url: msg.sticker_url || null,
        gif_url: msg.gif_url || null,
        is_animated: !!msg.is_animated,
        is_deleted: false,
        is_ephemeral: false,
        reactions: {},
        read_by: [],
      })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin
      .from('chats')
      .update({
        last_message: sanitizedText || 'Multimedia',
        last_message_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', msg.chat_id);

    const { data: senderProfile } = await supabaseAdmin
      .from('profiles')
      .select('name')
      .eq('id', msg.sender_id)
      .maybeSingle();

    sendPushToChat(msg.chat_id, msg.sender_id, senderProfile?.name, sanitizedText || 'Nuevo mensaje');

    res.json(message);
  } catch (err) {
    console.error('[MESSAGES] send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get messages for a chat (with pagination) ──────────────────
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const before = req.query.before;
    const after = req.query.after;

    if (!(await isChatMember(chatId, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const { data: clearRow } = await supabaseAdmin
      .from('chat_clears')
      .select('cleared_at')
      .eq('chat_id', chatId)
      .eq('user_id', req.userId)
      .maybeSingle();

    const clearedAt = clearRow?.cleared_at || null;

    let query = supabaseAdmin
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .eq('is_deleted', false);

    if (clearedAt) {
      query = query.gt('created_at', clearedAt);
    }

    if (after) {
      query = query.gt('created_at', after).order('created_at', { ascending: true }).limit(limit);
    } else if (before) {
      query = query.lt('created_at', before).order('created_at', { ascending: false }).limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      res.json((data || []).reverse());
      return;
    } else {
      query = query.order('created_at', { ascending: false }).limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      res.json((data || []).reverse());
      return;
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[MESSAGES] get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Mark messages as read (batch) ───────────────────────────────
router.post('/mark-read', async (req, res) => {
  try {
    const { chat_id, user_id, reader_name } = req.body;
    if (!chat_id || !user_id) {
      return res.status(400).json({ error: 'chat_id y user_id requeridos' });
    }

    if (req.userId !== user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!(await isChatMember(chat_id, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const name = reader_name || 'Usuario';

    const { data: clearRow } = await supabaseAdmin
      .from('chat_clears')
      .select('cleared_at')
      .eq('chat_id', chat_id)
      .eq('user_id', user_id)
      .maybeSingle();

    const clearedAt = clearRow?.cleared_at || null;

    let msgQuery = supabaseAdmin
      .from('messages')
      .select('id, read_by, status')
      .eq('chat_id', chat_id)
      .neq('sender_id', user_id)
      .eq('is_deleted', false);

    if (clearedAt) {
      msgQuery = msgQuery.gt('created_at', clearedAt);
    }

    const { data: messages, error: fetchError } = await msgQuery;

    if (fetchError) throw fetchError;

    if (!messages || messages.length === 0) {
      return res.json({ updated: 0 });
    }

    const now = new Date().toISOString();
    const unreadMessages = messages.filter(msg => {
      const currentReadBy = (msg.read_by || []);
      return !currentReadBy.some(r => r.userId === user_id);
    });

    if (unreadMessages.length === 0) {
      return res.json({ updated: 0 });
    }

    const messageIds = unreadMessages.map(m => m.id);

    const { error: batchError } = await supabaseAdmin
      .from('messages')
      .update({
        status: 'read',
        read_at: now,
      })
      .in('id', messageIds);

    if (batchError) {
      console.error('[MESSAGES] batch update error:', batchError);
      let updated = 0;
      for (const msg of unreadMessages) {
        const currentReadBy = (msg.read_by || []);
        const newReadBy = [...currentReadBy, { userId: user_id, name, readAt: now }];
        const { error: updateError } = await supabaseAdmin
          .from('messages')
          .update({ status: 'read', read_at: now, read_by: newReadBy })
          .eq('id', msg.id);
        if (!updateError) updated++;
      }
      return res.json({ updated });
    }

    res.json({ updated: unreadMessages.length });
  } catch (err) {
    console.error('[MESSAGES] mark-read error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Clear messages for me (per-user hide via chat_clears) ───────
router.post('/clear-for-me', async (req, res) => {
  try {
    const { chat_id } = req.body;
    if (!chat_id) return res.status(400).json({ error: 'chat_id requerido' });

    if (!(await isChatMember(chat_id, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('chat_clears')
      .upsert(
        { chat_id, user_id: req.userId, cleared_at: now },
        { onConflict: 'chat_id,user_id' }
      );

    if (error) throw error;
    res.json({ ok: true, cleared_at: now });
  } catch (err) {
    console.error('[MESSAGES] clear-for-me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete message (soft delete) ────────────────────────────────
router.post('/delete', async (req, res) => {
  try {
    const { message_id } = req.body;
    if (!message_id) return res.status(400).json({ error: 'message_id requerido' });

    const { data: msg, error: fetchError } = await supabaseAdmin
      .from('messages')
      .select('chat_id, text, sender_id')
      .eq('id', message_id)
      .single();

    if (fetchError) return res.status(404).json({ error: 'Mensaje no encontrado' });

    if (req.userId !== msg.sender_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios mensajes' });
    }

    if (!(await isChatMember(msg.chat_id, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const { error } = await supabaseAdmin
      .from('messages')
      .update({ is_deleted: true, text: null })
      .eq('id', message_id);

    if (error) throw error;

    if (msg.chat_id) {
      const { data: chat } = await supabaseAdmin
        .from('chats')
        .select('last_message')
        .eq('id', msg.chat_id)
        .single();
      if (chat && (chat.last_message === msg.text || !chat.last_message)) {
        const { data: prevMsg } = await supabaseAdmin
          .from('messages')
          .select('text, created_at')
          .eq('chat_id', msg.chat_id)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        await supabaseAdmin
          .from('chats')
          .update({
            last_message: prevMsg?.text || '',
            last_message_time: prevMsg?.created_at || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', msg.chat_id);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[MESSAGES] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Edit message text ─────────────────────────────────────────
router.post('/edit', async (req, res) => {
  try {
    const { message_id, new_text } = req.body;
    if (!message_id || new_text === undefined || new_text === null) {
      return res.status(400).json({ error: 'message_id y new_text requeridos' });
    }

    const sanitizedText = sanitizeText(new_text);
    if (!sanitizedText) {
      return res.status(400).json({ error: 'El texto no puede estar vacío' });
    }

    const { data: msg, error: fetchError } = await supabaseAdmin
      .from('messages')
      .select('chat_id, text, sender_id')
      .eq('id', message_id)
      .single();

    if (fetchError) return res.status(404).json({ error: 'Mensaje no encontrado' });

    if (req.userId !== msg.sender_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'Solo puedes editar tus propios mensajes' });
    }

    if (!(await isChatMember(msg.chat_id, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const { error } = await supabaseAdmin
      .from('messages')
      .update({ text: sanitizedText, edited: true })
      .eq('id', message_id);

    if (error) throw error;

    if (msg.chat_id) {
      const { data: chat } = await supabaseAdmin
        .from('chats')
        .select('last_message')
        .eq('id', msg.chat_id)
        .single();
      if (chat && chat.last_message === msg.text) {
        await supabaseAdmin
          .from('chats')
          .update({
            last_message: sanitizedText,
            updated_at: new Date().toISOString(),
          })
          .eq('id', msg.chat_id);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[MESSAGES] edit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Add reaction ────────────────────────────────────────────────
router.post('/react', reactLimiter, async (req, res) => {
  try {
    const { message_id, emoji } = req.body;
    if (!message_id || !emoji) {
      return res.status(400).json({ error: 'message_id y emoji requeridos' });
    }

    if (typeof emoji !== 'string' || emoji.length > MAX_EMOJI_LENGTH) {
      return res.status(400).json({ error: 'Emoji inválido' });
    }

    const { data: msg, error: fetchError } = await supabaseAdmin
      .from('messages')
      .select('reactions, chat_id')
      .eq('id', message_id)
      .single();

    if (fetchError) throw fetchError;

    if (!(await isChatMember(msg.chat_id, req.userId))) {
      return res.status(403).json({ error: 'No eres miembro de este chat' });
    }

    const reactions = (msg?.reactions || {});
    reactions[emoji] = (reactions[emoji] || 0) + 1;

    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({ reactions })
      .eq('id', message_id);

    if (updateError) throw updateError;
    res.json({ reactions });
  } catch (err) {
    console.error('[MESSAGES] react error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

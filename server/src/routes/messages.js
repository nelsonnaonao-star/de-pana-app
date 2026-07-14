import { Router } from 'express';
import { supabaseAdmin } from '../db.js';

const router = Router();

// ─── Send message ────────────────────────────────────────────────
router.post('/send', async (req, res) => {
  try {
    const msg = req.body;
    if (!msg.chat_id || !msg.sender_id) {
      return res.status(400).json({ error: 'chat_id y sender_id requeridos' });
    }

    if (req.userId !== msg.sender_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No puedes enviar mensajes como otro usuario' });
    }

    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        chat_id: msg.chat_id,
        sender_id: msg.sender_id,
        receiver_id: msg.receiver_id || null,
        text: msg.text || null,
        type: msg.type || 'text',
        status: 'sent',
        created_at: new Date().toISOString(),
        edited: false,
        forwarded: false,
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
        has_location: false,
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
        last_message: msg.text || 'Multimedia',
        last_message_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', msg.chat_id);

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

    let query = supabaseAdmin
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .eq('is_deleted', false);

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

    const name = reader_name || 'Usuario';

    const { data: messages, error: fetchError } = await supabaseAdmin
      .from('messages')
      .select('id, read_by, status')
      .eq('chat_id', chat_id)
      .neq('sender_id', user_id)
      .eq('is_deleted', false);

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

// ─── Add reaction ────────────────────────────────────────────────
router.post('/react', async (req, res) => {
  try {
    const { message_id, emoji } = req.body;
    if (!message_id || !emoji) {
      return res.status(400).json({ error: 'message_id y emoji requeridos' });
    }

    const { data: msg, error: fetchError } = await supabaseAdmin
      .from('messages')
      .select('reactions')
      .eq('id', message_id)
      .single();

    if (fetchError) throw fetchError;

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
